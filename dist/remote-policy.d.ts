/**
 * Public reads that work without a key. Each one already falls back to an unauthenticated
 * backend request (or makes no network call at all), so no caller credentials are involved.
 */
export declare const ANON_TOOLS: ReadonlySet<string>;
/**
 * Tools that only make sense for a local process that owns a credentials file, or that hand
 * out a fresh key without the caller proving anything (account creation, recovery-code
 * brute force). They are hidden from tools/list and refused on the remote server.
 */
export declare const STDIO_ONLY_TOOLS: ReadonlySet<string>;
/**
 * Tools that move sats out of, into, or between balances (or stake them). The kill switch
 * refuses all of them at once; they also get a tighter per-key rate limit.
 */
export declare const MONEY_TOOLS: ReadonlySet<string>;
export type ToolDecision = {
    allow: true;
    money: boolean;
} | {
    allow: false;
    error: 'not_available_remotely' | 'auth_required' | 'money_tools_disabled';
    message: string;
};
export declare function decideTool(name: string, opts: {
    authenticated: boolean;
    killSwitch: boolean;
}): ToolDecision;
export type BearerResult = {
    kind: 'none';
} | {
    kind: 'key';
    key: string;
} | {
    kind: 'invalid';
};
export declare function parseBearer(header: string | string[] | undefined): BearerResult;
/** Short, non-reversible tag for logs and rate-limit buckets. Never log the key itself. */
export declare function keyTag(key: string): string;
/**
 * Resolve the caller's address. Forwarded headers are trusted only when the TCP peer is a
 * trusted proxy (Apache on the same host); otherwise the socket address is used.
 */
export declare function resolveClientIp(peer: string | undefined, headers: Record<string, string | string[] | undefined>, trustedProxies: ReadonlySet<string>): string | null;
/** True for loopback, RFC1918, link-local, CGNAT, ULA and other non-routable addresses. */
export declare function isPrivateIp(ip: string): boolean;
export declare function originAllowed(origin: string, allowed: ReadonlySet<string>): boolean;
export declare function hostAllowed(host: string | undefined, allowed: ReadonlySet<string>): boolean;
/** Fixed-window counters keyed by bucket name. In memory: one process, restarts reset it. */
export declare class RateLimiter {
    private readonly maxEntries;
    private windows;
    constructor(maxEntries?: number);
    /** Count one hit. Returns 0 when allowed, else the seconds until the window resets. */
    hit(bucket: string, limit: number, windowMs: number, now?: number): number;
    sweep(now?: number): void;
    get size(): number;
}
/** Amount in sats a call asks to move, for the audit log. Never returns secrets. */
export declare function amountForLog(name: string, args: unknown): number | null;
export declare const MAX_RESULT_CHARS = 60000;
type TextResult = {
    content: {
        type: 'text';
        text: string;
    }[];
    isError?: boolean;
};
/** Keep any single tool result under MAX_RESULT_CHARS so a huge reply cannot flood a model context. */
export declare function capResult<T extends TextResult>(result: T, max?: number): T;
export {};
