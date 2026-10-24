/**
 * Policy for the remote (Streamable HTTP) MCP server: which tools run anonymously, which
 * need a key, which move money (kill switch), which are stdio-only, plus rate limiting,
 * client address resolution, key validation and log redaction.
 *
 * Pure and side-effect free so it can be unit tested without starting a server.
 */
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { bolt11AmountSats } from './bolt11.js';

/**
 * Public reads that work without a key. Each one already falls back to an unauthenticated
 * backend request (or makes no network call at all), so no caller credentials are involved.
 */
export const ANON_TOOLS: ReadonlySet<string> = new Set([
  'get_info',
  'decode_invoice',
  'list_l402_apis',
  'verify_fair',
  'prediction_markets',
  'prediction_market',
  'arena_list',
  'arena_leaderboard',
  'gateway_catalog',
  'pickem_browse',
  'tournament_list',
]);

/**
 * Tools that only make sense for a local process that owns a credentials file, or that hand
 * out a fresh key without the caller proving anything (account creation, recovery-code
 * brute force). They are hidden from tools/list and refused on the remote server.
 */
export const STDIO_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'register_operator',
  'recover_account',
  'set_operator_key',
  'set_agent_credentials',
  'forget_credentials',
]);

/**
 * Tools that move sats out of, into, or between balances (or stake them). The kill switch
 * refuses all of them at once; they also get a tighter per-key rate limit.
 */
export const MONEY_TOOLS: ReadonlySet<string> = new Set([
  'pay_invoice',
  'pay_l402_api',
  'pay_lightning_address',
  'keysend',
  'nostr_zap',
  'withdraw',
  'create_withdraw_link',
  'claim_lnurl_withdraw',
  'claim_promo',
  'fund_agent',
  'transfer_to_agent',
  'sweep_agent',
  'delete_agent',
  'link_user',
  'board_post',
  'board_reply',
  'board_vote',
  'arena_join',
  'prediction_place_bet',
]);

export type ToolDecision =
  | { allow: true; money: boolean }
  | { allow: false; error: 'not_available_remotely' | 'auth_required' | 'money_tools_disabled'; message: string };

export function decideTool(name: string, opts: { authenticated: boolean; killSwitch: boolean }): ToolDecision {
  if (STDIO_ONLY_TOOLS.has(name)) {
    return {
      allow: false,
      error: 'not_available_remotely',
      message: `${name} is not available on the remote server. Create or recover a key at https://lightningfaucet.com/ai-agents/ (or with the local package: npx lightning-wallet-mcp), then send it as "Authorization: Bearer <key>".`,
    };
  }
  const money = MONEY_TOOLS.has(name);
  if (!opts.authenticated && !ANON_TOOLS.has(name)) {
    return {
      allow: false,
      error: 'auth_required',
      message: `${name} needs an API key. Connect with the header "Authorization: Bearer <key>" using an operator key (lf_...) or an agent key (agent_...). Get one at https://lightningfaucet.com/ai-agents/. Anonymous callers can use: ${[...ANON_TOOLS].join(', ')}.`,
    };
  }
  if (money && opts.killSwitch) {
    return {
      allow: false,
      error: 'money_tools_disabled',
      message: 'Payments, transfers and bets are temporarily disabled on the remote server. Read-only tools still work. Try again later.',
    };
  }
  return { allow: true, money };
}

// ─── Keys ───────────────────────────────────────────────────────────────

/** Operator keys are lf_ + 48 hex, agent keys agent_ + 48 hex. Accept a little slack in length. */
const KEY_RE = /^(lf_|agent_)[A-Za-z0-9]{16,128}$/;

export type BearerResult = { kind: 'none' } | { kind: 'key'; key: string } | { kind: 'invalid' };

export function parseBearer(header: string | string[] | undefined): BearerResult {
  if (header === undefined || header === '') return { kind: 'none' };
  if (Array.isArray(header)) return { kind: 'invalid' };
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!m) return { kind: 'invalid' };
  return KEY_RE.test(m[1]) ? { kind: 'key', key: m[1] } : { kind: 'invalid' };
}

/** Short, non-reversible tag for logs and rate-limit buckets. Never log the key itself. */
export function keyTag(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

// ─── Client address ─────────────────────────────────────────────────────

function normalizeIp(raw: string | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) ? ip : null;
}

/**
 * Resolve the caller's address. Forwarded headers are trusted only when the TCP peer is a
 * trusted proxy (Apache on the same host); otherwise the socket address is used.
 */
export function resolveClientIp(
  peer: string | undefined,
  headers: Record<string, string | string[] | undefined>,
  trustedProxies: ReadonlySet<string>,
): string | null {
  const peerIp = normalizeIp(peer);
  if (!peerIp) return null;
  if (!trustedProxies.has(peerIp)) return peerIp;
  const real = headers['x-real-ip'];
  if (typeof real === 'string') {
    const ip = normalizeIp(real);
    if (ip) return ip;
  }
  const xff = headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    const ip = normalizeIp(xff.split(',')[0]);
    if (ip) return ip;
  }
  return peerIp;
}

/** True for loopback, RFC1918, link-local, CGNAT, ULA and other non-routable addresses. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    return s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9')
      || s.startsWith('fea') || s.startsWith('feb') || s.startsWith('ff');
  }
  return true;
}

// ─── Origin / Host (DNS rebinding protection, CORS) ─────────────────────

const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export function originAllowed(origin: string, allowed: ReadonlySet<string>): boolean {
  return allowed.has(origin) || LOCAL_ORIGIN_RE.test(origin);
}

export function hostAllowed(host: string | undefined, allowed: ReadonlySet<string>): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/:\d{1,5}$/, '');
  return allowed.has(h);
}

// ─── Rate limiting ──────────────────────────────────────────────────────

/** Fixed-window counters keyed by bucket name. In memory: one process, restarts reset it. */
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly maxEntries = 100_000) {}

  /** Count one hit. Returns 0 when allowed, else the seconds until the window resets. */
  hit(bucket: string, limit: number, windowMs: number, now = Date.now()): number {
    if (limit <= 0) return 0;
    let w = this.windows.get(bucket);
    if (!w || w.resetAt <= now) {
      if (this.windows.size >= this.maxEntries) this.sweep(now);
      w = { count: 0, resetAt: now + windowMs };
      this.windows.set(bucket, w);
    }
    w.count++;
    return w.count > limit ? Math.max(1, Math.ceil((w.resetAt - now) / 1000)) : 0;
  }

  sweep(now = Date.now()): void {
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
    // Still full of live windows (flood of distinct IPs): drop everything rather than grow.
    if (this.windows.size >= this.maxEntries) this.windows.clear();
  }

  get size(): number {
    return this.windows.size;
  }
}

// ─── Logging and output caps ────────────────────────────────────────────

/** Amount in sats a call asks to move, for the audit log. Never returns secrets. */
export function amountForLog(name: string, args: unknown): number | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  for (const k of ['amount_sats', 'stake_sats', 'max_payment_sats', 'amount']) {
    const v = a[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  if ((name === 'pay_invoice' || name === 'withdraw') && typeof a.bolt11 === 'string') {
    return bolt11AmountSats(a.bolt11);
  }
  if (name === 'withdraw' && typeof a.invoice === 'string') return bolt11AmountSats(a.invoice);
  return null;
}

export const MAX_RESULT_CHARS = 60_000;

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

/** Keep any single tool result under MAX_RESULT_CHARS so a huge reply cannot flood a model context. */
export function capResult<T extends TextResult>(result: T, max = MAX_RESULT_CHARS): T {
  const total = result.content.reduce((n, c) => n + (c.text?.length ?? 0), 0);
  if (total <= max) return result;
  const joined = result.content.map((c) => c.text).join('\n');
  const notice = {
    truncated: true,
    original_chars: total,
    message: `Result was larger than ${max} characters and was cut. Narrow the request (filters, limit, date range) and call again.`,
  };
  // Escaping (quotes, backslashes, newlines) can grow `partial` when serialized, so measure the
  // final text and shrink until it fits.
  let room = Math.max(0, max - JSON.stringify(notice).length - 32);
  let text = JSON.stringify({ ...notice, partial: joined.slice(0, room) });
  while (text.length > max && room > 0) {
    room = Math.floor(room * Math.min(0.9, max / text.length));
    text = JSON.stringify({ ...notice, partial: joined.slice(0, room) });
  }
  return { ...result, content: [{ type: 'text', text }] };
}
