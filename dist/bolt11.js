"use strict";
/**
 * Minimal, dependency-free BOLT11 amount decoder.
 *
 * Reads only the amount from the invoice's human-readable prefix (HRP). It does
 * NOT bech32-decode the data part and makes no network call. Returns the amount
 * in sats, or null when the invoice is amountless or cannot be confidently
 * parsed — callers treat null as "amount unknown" and degrade gracefully.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.bolt11AmountSats = bolt11AmountSats;
// msats per 1 unit of each multiplier (1 BTC = 1e11 msat).
const MSAT_PER_UNIT = {
    m: 1e8, // milli  (1e-3 BTC)
    u: 1e5, // micro  (1e-6 BTC)
    n: 1e2, // nano   (1e-9 BTC)
    p: 1e-1, // pico  (1e-12 BTC)
};
function bolt11AmountSats(invoice) {
    try {
        const lower = invoice.trim().toLowerCase();
        if (!lower.startsWith('ln'))
            return null;
        // The bech32 data part never contains '1', so the LAST '1' is the separator
        // between the human-readable prefix and the data.
        const sep = lower.lastIndexOf('1');
        if (sep < 1)
            return null;
        const hrp = lower.slice(0, sep);
        // hrp = 'ln' + currency-prefix + <digits><multiplier?>. Amountless invoices
        // (no digits) and unknown currency prefixes do not match → null.
        const match = hrp.match(/^ln(?:bcrt|bc|tb|sb)(\d+)([munp])?$/);
        if (!match)
            return null;
        const digits = match[1];
        const multiplier = match[2];
        let msat;
        if (multiplier) {
            const factor = MSAT_PER_UNIT[multiplier];
            if (factor === undefined)
                return null;
            msat = Number(digits) * factor;
        }
        else {
            msat = Number(digits) * 1e11; // whole BTC
        }
        if (!Number.isFinite(msat) || msat < 0)
            return null;
        return Math.round(msat / 1000);
    }
    catch {
        return null;
    }
}
