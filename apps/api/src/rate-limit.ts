const MAX_KEYS = 10_000;

/**
 * A small rate limiter: at most `max` requests per key in its time window, counted from that key's
 * first request. Counts live in memory, so each API process counts separately, and at most
 * `MAX_KEYS` live keys are kept at once. That's enough to slow down guessing, without letting a
 * flood of made-up keys fill memory. Keys are only held for the window and are never written anywhere.
 */
export function createRateLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const entries = new Map<string, { start: number; count: number }>();

  return (key: string, now = Date.now()): boolean => {
    const current = entries.get(key);
    if (!current || now - current.start >= windowMs) {
      if (!current && entries.size >= MAX_KEYS) {
        for (const [known, entry] of entries) {
          if (now - entry.start >= windowMs) {
            entries.delete(known);
          }
        }
        if (entries.size >= MAX_KEYS) {
          return false;
        }
      }
      entries.set(key, { start: now, count: 1 });
      return 1 <= max;
    }
    current.count += 1;
    return current.count <= max;
  };
}
