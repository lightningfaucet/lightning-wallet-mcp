/**
 * Minimal, dependency-free BOLT11 amount decoder.
 *
 * Reads only the amount from the invoice's human-readable prefix (HRP). It does
 * NOT bech32-decode the data part and makes no network call. Returns the amount
 * in sats, or null when the invoice is amountless or cannot be confidently
 * parsed — callers treat null as "amount unknown" and degrade gracefully.
 */
export declare function bolt11AmountSats(invoice: string): number | null;
