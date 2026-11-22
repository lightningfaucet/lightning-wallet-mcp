/**
 * Strict integer parsing for CLI flags and env values. parseInt alone accepts "12abc",
 * returns NaN for garbage and happily yields negatives, so every numeric input goes through here.
 */
export function parseStrictInt(
  value: unknown,
  opts: { min?: number; max?: number } = {}
): number | null {
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else {
    const s = String(value ?? '').trim();
    if (!/^[+-]?\d+$/.test(s)) return null;
    n = Number(s);
  }
  if (!Number.isSafeInteger(n)) return null;
  if (opts.min !== undefined && n < opts.min) return null;
  if (opts.max !== undefined && n > opts.max) return null;
  return n;
}

export function describeIntRange(opts: { min?: number; max?: number }): string {
  if (opts.min !== undefined && opts.max !== undefined) return `an integer between ${opts.min} and ${opts.max}`;
  if (opts.min !== undefined) return `an integer >= ${opts.min}`;
  if (opts.max !== undefined) return `an integer <= ${opts.max}`;
  return 'an integer';
}
