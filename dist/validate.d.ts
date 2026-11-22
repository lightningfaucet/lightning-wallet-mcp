/**
 * Strict integer parsing for CLI flags and env values. parseInt alone accepts "12abc",
 * returns NaN for garbage and happily yields negatives, so every numeric input goes through here.
 */
export declare function parseStrictInt(value: unknown, opts?: {
    min?: number;
    max?: number;
}): number | null;
export declare function describeIntRange(opts: {
    min?: number;
    max?: number;
}): string;
