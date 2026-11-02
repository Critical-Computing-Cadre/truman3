/**
 * A small seeded random number generator (mulberry32), returning numbers from 0 up to 1. The same
 * seed always gives the same sequence, so anything drawn with it can be reproduced. It's fine for
 * study design, like like counts and feed order, but not for anything security related.
 */
export function createRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickFrom<T>(values: readonly T[], random: () => number): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) {
    throw new Error("Can't pick from an empty list.");
  }
  return value;
}

/** A shuffled copy of a list (Fisher-Yates). */
export function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}
