/**
 * Pre-Payment Policy Hook
 *
 * An optional, vendor-neutral hook that lets an external policy endpoint allow
 * or deny a payment *before* it executes. When `PRE_PAYMENT_HOOK_URL` is unset
 * the hook is inert and payment behaviour is identical to having no hook at all.
 *
 * This module contains no vendor-specific logic. It POSTs a generic payment
 * proposal and interprets a generic decision, so any policy service that speaks
 * the documented request/response contract can be wired in by configuration
 * alone. The proposal deliberately carries NO wallet credentials.
 */

export type PaymentProtocol = 'l402' | 'x402' | 'bolt11' | 'keysend' | 'lnaddress';
export type HookFailMode = 'closed' | 'open';

export interface PrePaymentProposal {
  /** Unique id for this proposal (one per payment attempt). */
  proposal_id: string;
  /** The paying agent's id, when resolvable; null otherwise. */
  agent_id: number | null;
  /** Payment protocol being attempted. */
  protocol: PaymentProtocol;
  /** Destination address, node pubkey, lightning address, invoice, or target URL. */
  destination_or_url: string;
  /** Exact amount when known at hook time; null when the protocol determines it later. */
  amount_sats: number | null;
  /** Upper bound the agent authorised, when applicable; null otherwise. */
  max_payment_sats: number | null;
  /** HTTP method for L402/X402 URL payments; null for direct Lightning payments. */
  method: string | null;
  /** ISO-8601 timestamp of the proposal. */
  ts: string;
}

export interface HookDecisionReason {
  code?: string;
  message?: string;
}

export interface HookDecision {
  decision: 'allow' | 'deny';
  reason?: HookDecisionReason;
  /** Opaque to this client; forwarded/logged only. */
  attestation?: unknown;
}

export interface PrePaymentHookConfig {
  url: string;
  timeoutMs: number;
  failMode: HookFailMode;
}

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Read hook configuration from the environment. Returns null when no hook URL is
 * configured, in which case callers MUST behave exactly as before.
 *
 * - `PRE_PAYMENT_HOOK_URL` — when set, enables the hook.
 * - `PRE_PAYMENT_HOOK_TIMEOUT_MS` — request timeout; defaults to 3000.
 * - `PRE_PAYMENT_HOOK_FAIL_MODE` — `closed` (default) denies on hook error/timeout;
 *   `open` proceeds on hook error/timeout.
 */
export function getPrePaymentHookConfig(
  env: Record<string, string | undefined> = process.env
): PrePaymentHookConfig | null {
  const url = env.PRE_PAYMENT_HOOK_URL?.trim();
  if (!url) {
    return null;
  }

  const timeoutRaw = env.PRE_PAYMENT_HOOK_TIMEOUT_MS?.trim();
  const parsedTimeout = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : NaN;
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS;

  // Default fail-closed: when a hook is configured, a hook error denies the payment.
  const failMode: HookFailMode =
    env.PRE_PAYMENT_HOOK_FAIL_MODE?.trim().toLowerCase() === 'open' ? 'open' : 'closed';

  return { url, timeoutMs, failMode };
}

/**
 * Error thrown when a payment is denied — either explicitly by the hook
 * (`decision: "deny"`) or implicitly by a hook error under fail-closed mode.
 */
export class PolicyDenied extends Error {
  readonly code: string;
  readonly reason?: HookDecisionReason;

  constructor(message: string, code = 'policy_denied', reason?: HookDecisionReason) {
    super(message);
    this.name = 'PolicyDenied';
    this.code = code;
    this.reason = reason;
  }
}

export interface RunHookDeps {
  /** Injectable fetch, primarily for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Run the pre-payment hook for a proposal.
 *
 * - decision `allow`: resolves with the (opaque) attestation, if any.
 * - decision `deny`: throws {@link PolicyDenied} carrying the structured reason.
 * - transport error / timeout / non-2xx / malformed response: applies failMode —
 *   `closed` throws {@link PolicyDenied}; `open` resolves (payment proceeds) after
 *   logging the failure to stderr.
 */
export async function runPrePaymentHook(
  proposal: PrePaymentProposal,
  config: PrePaymentHookConfig,
  deps: RunHookDeps = {}
): Promise<{ attestation?: unknown }> {
  const doFetch = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  // The timer lives in a try/finally with NO catch: a fail-closed PolicyDenied
  // (from applyFailMode or the deny branch) propagates straight out, clearing
  // the timer, and is never caught and re-wrapped. Only the fetch and the body
  // read are wrapped in their own try/catch, so their failures map to fail-mode
  // exactly once with the right detail.
  try {
    let response: Awaited<ReturnType<typeof doFetch>>;
    try {
      response = await doFetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proposal),
        signal: controller.signal,
      });
    } catch (err) {
      return applyFailMode(config, transportDetail(err, config));
    }

    // Non-2xx is handled OUTSIDE the fetch try/catch so the status detail is
    // preserved and fail-mode runs once.
    if (!response.ok) {
      return applyFailMode(config, `policy hook returned HTTP ${response.status}`);
    }

    let decision: HookDecision;
    try {
      decision = (await response.json()) as HookDecision;
    } catch (err) {
      return applyFailMode(config, transportDetail(err, config, 'policy hook returned an unparseable body'));
    }

    if (decision?.decision === 'allow') {
      return { attestation: decision.attestation };
    }

    if (decision?.decision === 'deny') {
      const reason = decision.reason;
      const detail = reason?.message || 'payment denied by policy';
      throw new PolicyDenied(
        `Payment blocked by pre-payment policy hook: ${detail}`,
        reason?.code || 'policy_denied',
        reason
      );
    }

    // Malformed/unknown decision — treat as a hook error and apply the fail mode.
    return applyFailMode(config, 'policy hook returned an unrecognized decision');
  } finally {
    clearTimeout(timer);
  }
}

function transportDetail(
  err: unknown,
  config: PrePaymentHookConfig,
  fallback = 'policy hook request failed'
): string {
  return err instanceof Error && err.name === 'AbortError'
    ? `policy hook timed out after ${config.timeoutMs}ms`
    : fallback;
}

function applyFailMode(config: PrePaymentHookConfig, detail: string): { attestation?: unknown } {
  if (config.failMode === 'open') {
    // Fail-open: allow the payment, but record the hook failure on stderr.
    console.error(`[pre-payment-hook] fail-open: proceeding despite ${detail}`);
    return {};
  }
  throw new PolicyDenied(
    `Payment blocked by pre-payment policy hook (fail-closed): ${detail}`,
    'policy_hook_unavailable'
  );
}
