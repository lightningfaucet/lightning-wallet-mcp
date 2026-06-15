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
/**
 * Read hook configuration from the environment. Returns null when no hook URL is
 * configured, in which case callers MUST behave exactly as before.
 *
 * - `PRE_PAYMENT_HOOK_URL` — when set, enables the hook.
 * - `PRE_PAYMENT_HOOK_TIMEOUT_MS` — request timeout; defaults to 3000.
 * - `PRE_PAYMENT_HOOK_FAIL_MODE` — `closed` (default) denies on hook error/timeout;
 *   `open` proceeds on hook error/timeout.
 */
export declare function getPrePaymentHookConfig(env?: Record<string, string | undefined>): PrePaymentHookConfig | null;
/**
 * Error thrown when a payment is denied — either explicitly by the hook
 * (`decision: "deny"`) or implicitly by a hook error under fail-closed mode.
 */
export declare class PolicyDenied extends Error {
    readonly code: string;
    readonly reason?: HookDecisionReason;
    constructor(message: string, code?: string, reason?: HookDecisionReason);
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
export declare function runPrePaymentHook(proposal: PrePaymentProposal, config: PrePaymentHookConfig, deps?: RunHookDeps): Promise<{
    attestation?: unknown;
}>;
