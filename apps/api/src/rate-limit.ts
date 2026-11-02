/**
 * A small rate limiter: at most `max` requests per key in each time window. Counts live in memory,
 * so each API process counts separately. That's enough to slow down guessing, not a precise limit.
 * Keys are only held for the window and are never written anywhere.
 */
export function createRateLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  let windowStart = 0;
  let counts = new Map<string, number>();

  return (key: string, now = Date.now()): boolean => {
    if (now - windowStart >= windowMs) {
      windowStart = now;
      counts = new Map();
    }
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return count <= max;
  };
}
