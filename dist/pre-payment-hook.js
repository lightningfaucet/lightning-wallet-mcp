"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyDenied = void 0;
exports.getPrePaymentHookConfig = getPrePaymentHookConfig;
exports.runPrePaymentHook = runPrePaymentHook;
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
function getPrePaymentHookConfig(env = process.env) {
    const url = env.PRE_PAYMENT_HOOK_URL?.trim();
    if (!url) {
        return null;
    }
    const timeoutRaw = env.PRE_PAYMENT_HOOK_TIMEOUT_MS?.trim();
    const parsedTimeout = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : NaN;
    const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS;
    // Default fail-closed: when a hook is configured, a hook error denies the payment.
    const failMode = env.PRE_PAYMENT_HOOK_FAIL_MODE?.trim().toLowerCase() === 'open' ? 'open' : 'closed';
    return { url, timeoutMs, failMode };
}
/**
 * Error thrown when a payment is denied — either explicitly by the hook
 * (`decision: "deny"`) or implicitly by a hook error under fail-closed mode.
 */
class PolicyDenied extends Error {
    code;
    reason;
    constructor(message, code = 'policy_denied', reason) {
        super(message);
        this.name = 'PolicyDenied';
        this.code = code;
        this.reason = reason;
    }
}
exports.PolicyDenied = PolicyDenied;
/**
 * Run the pre-payment hook for a proposal.
 *
 * - decision `allow`: resolves with the (opaque) attestation, if any.
 * - decision `deny`: throws {@link PolicyDenied} carrying the structured reason.
 * - transport error / timeout / non-2xx / malformed response: applies failMode —
 *   `closed` throws {@link PolicyDenied}; `open` resolves (payment proceeds) after
 *   logging the failure to stderr.
 */
async function runPrePaymentHook(proposal, config, deps = {}) {
    const doFetch = deps.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    // The timer lives in a try/finally with NO catch: a fail-closed PolicyDenied
    // (from applyFailMode or the deny branch) propagates straight out, clearing
    // the timer, and is never caught and re-wrapped. Only the fetch and the body
    // read are wrapped in their own try/catch, so their failures map to fail-mode
    // exactly once with the right detail.
    try {
        let response;
        try {
            response = await doFetch(config.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(proposal),
                signal: controller.signal,
            });
        }
        catch (err) {
            return applyFailMode(config, transportDetail(err, config));
        }
        // Non-2xx is handled OUTSIDE the fetch try/catch so the status detail is
        // preserved and fail-mode runs once.
        if (!response.ok) {
            return applyFailMode(config, `policy hook returned HTTP ${response.status}`);
        }
        let decision;
        try {
            decision = (await response.json());
        }
        catch (err) {
            return applyFailMode(config, transportDetail(err, config, 'policy hook returned an unparseable body'));
        }
        if (decision?.decision === 'allow') {
            return { attestation: decision.attestation };
        }
        if (decision?.decision === 'deny') {
            const reason = decision.reason;
            const detail = reason?.message || 'payment denied by policy';
            throw new PolicyDenied(`Payment blocked by pre-payment policy hook: ${detail}`, reason?.code || 'policy_denied', reason);
        }
        // Malformed/unknown decision — treat as a hook error and apply the fail mode.
        return applyFailMode(config, 'policy hook returned an unrecognized decision');
    }
    finally {
        clearTimeout(timer);
    }
}
function transportDetail(err, config, fallback = 'policy hook request failed') {
    return err instanceof Error && err.name === 'AbortError'
        ? `policy hook timed out after ${config.timeoutMs}ms`
        : fallback;
}
function applyFailMode(config, detail) {
    if (config.failMode === 'open') {
        // Fail-open: allow the payment, but record the hook failure on stderr.
        console.error(`[pre-payment-hook] fail-open: proceeding despite ${detail}`);
        return {};
    }
    throw new PolicyDenied(`Payment blocked by pre-payment policy hook (fail-closed): ${detail}`, 'policy_hook_unavailable');
}
