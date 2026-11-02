import { describe, expect, it } from "vitest";
import { createRandom, pickFrom, shuffled } from "./random.ts";

describe("createRandom", () => {
  it("gives the same sequence for the same seed", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("gives different sequences for different seeds", () => {
    expect(createRandom(1)()).not.toBe(createRandom(2)());
  });

  it("stays between 0 and 1, and spreads across that range", () => {
    const random = createRandom(7);
    const values = Array.from({ length: 10_000 }, () => random());

    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });
});

describe("pickFrom", () => {
  it("can reach every value, with repeats making a value more likely", () => {
    const random = createRandom(3);
    const picks = Array.from({ length: 3000 }, () => pickFrom([1, 1, 2], random));
    const ones = picks.filter((pick) => pick === 1).length;

    expect(new Set(picks)).toEqual(new Set([1, 2]));
    expect(ones).toBeGreaterThan(1800);
    expect(ones).toBeLessThan(2200);
  });

  it("refuses an empty list", () => {
    expect(() => pickFrom([], createRandom(1))).toThrow();
  });
});

describe("shuffled", () => {
  it("keeps every value, doesn't change the original, and is reproducible", () => {
    const original = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = shuffled(original, createRandom(9));

    expect(result).toHaveLength(8);
    expect([...result].sort()).toEqual(original);
    expect(original).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result).not.toEqual(original);
    expect(shuffled(original, createRandom(9))).toEqual(result);
  });
});
