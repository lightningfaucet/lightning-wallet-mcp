/**
 * MCP tool annotations (spec 2025-06-18: title, readOnlyHint, destructiveHint, idempotentHint,
 * openWorldHint) for every tool, kept in ONE table so a reviewer can audit them side by side.
 *
 * Policy: read-only lookups are readOnlyHint true. Anything that moves sats, stakes sats, spends
 * sats on a board action, rotates or deletes credentials, or cannot be undone is
 * readOnlyHint false + destructiveHint true. When in doubt a tool is destructive. A tool missing
 * from this table still gets the conservative destructive default, and test/annotations.test.js
 * fails until it is classified.
 */

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

/** R = read-only, D = destructive (money or irreversible), W = additive/overwriting write, not destructive. */
type Kind = 'R' | 'D' | 'W';
/** [kind, idempotent, openWorld] */
type Entry = [Kind, boolean, boolean];

const R: Entry = ['R', true, false];
const RO: Entry = ['R', true, true];
const D: Entry = ['D', false, false];
const DO: Entry = ['D', false, true];
const DI: Entry = ['D', true, false];
const W: Entry = ['W', false, false];
const WI: Entry = ['W', true, false];
const WIO: Entry = ['W', true, true];
const WO: Entry = ['W', false, true];

export const TOOL_KINDS: Record<string, Entry> = {
  // Money out, money staked, or irreversible
  pay_l402_api: DO, pay_invoice: DO, pay_lightning_address: DO, keysend: DO, nostr_zap: DO,
  withdraw: DO, create_withdraw_link: D, claim_lnurl_withdraw: DO, claim_promo: D,
  fund_agent: D, transfer_to_agent: D, sweep_agent: D, delete_agent: DI,
  link_user: D, link_account: D, recover_account: D, rotate_api_key: D, forget_credentials: DI,
  deactivate_agent: DI, delete_webhook: DI, gateway_delete: DI,
  set_nostr_identity: DI, board_set_profile: DI,
  place_bet: D, play_dice: D, prediction_place_bet: D, arena_join: D, arena_play: D, arena_reveal_seed: D,
  board_post: D, board_reply: D, board_vote: D, board_tip: D,
  board_bounty_create: D, board_bounty_award: D, board_bounty_close: D,
  // gateway_probe sends the caller's chosen method (GET/POST/PUT/DELETE) with caller headers to an external URL
  gateway_probe: DO,
  // Safe writes: no sats move and nothing is lost. board_inbox marks notifications read by default.
  board_inbox: WI,
  create_invoice: W, get_deposit_invoice: W, create_agent: W, register_operator: W,
  register_webhook: WO, test_webhook: WO, gateway_register: W, lnurl_auth: WO,
  update_operator: WI, set_budget: WI, set_spend_policy: WI, reactivate_agent: WI,
  set_operator_key: WI, set_agent_credentials: WI, arena_set_client_seed: WI,
  gateway_update: WI, gateway_pause: WI, gateway_resume: WI,
  // Read-only
  check_balance: R, get_invoice_status: R, get_transactions: R, list_agents: R, whoami: R,
  list_webhooks: R, get_budget_status: R, get_info: R, decode_invoice: R, get_rate_limits: R,
  get_nostr_identity: R, board_read: R, markets_browse: R, get_earn_status: R,
  get_agent_limits: R, board_agent_profile: R, board_agent_badge: R, arena_list: R, arena_entry: R,
  arena_leaderboard: R, arena_fairness: R, prediction_markets: R, prediction_market: R,
  prediction_my_bets: R, prediction_positions: R, export_transactions: R, get_agent_analytics: R,
  gateway_catalog: R, gateway_list: R, gateway_stats: R, list_l402_apis: R, verify_fair: R,
  get_spend_policy: R, pickem_browse: R, tournament_list: R,
};

const WORDS: Record<string, string> = {
  l402: 'L402', lnurl: 'LNURL', api: 'API', apis: 'APIs', nostr: 'Nostr', id: 'ID',
  bolt11: 'BOLT11', pickem: "Pick'em", fair: 'Fair',
};

export function toolTitle(name: string): string {
  return name.split('_').map((w) => WORDS[w] ?? w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function annotationsFor(name: string): ToolAnnotations {
  const entry = TOOL_KINDS[name];
  // Unclassified tool: assume the worst (destructive, open world) until someone labels it.
  if (!entry) return { title: toolTitle(name), readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
  const [kind, idempotent, openWorld] = entry;
  return {
    title: toolTitle(name),
    readOnlyHint: kind === 'R',
    // The spec only defines destructiveHint when readOnlyHint is false; send false for read-only tools.
    destructiveHint: kind === 'D',
    idempotentHint: idempotent,
    openWorldHint: openWorld,
  };
}

export function withAnnotations<T extends { name: string }>(defs: T[]): (T & { annotations: ToolAnnotations })[] {
  return defs.map((d) => ({ ...d, annotations: annotationsFor(d.name) }));
}
