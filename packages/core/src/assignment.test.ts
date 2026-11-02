import { describe, expect, it } from "vitest";
import { armProbability, blockedArm, pickUniformArm } from "./assignment.ts";
import { createRandom } from "./random.ts";

const ARMS = [
  { key: "a", weight: 1 },
  { key: "b", weight: 3 },
];

describe("armProbability", () => {
  it("follows the weights", () => {
    expect(armProbability(ARMS, "a")).toBe(0.25);
    expect(armProbability(ARMS, "b")).toBe(0.75);
  });
});

describe("pickUniformArm", () => {
  it("divides the range by weight", () => {
    expect(pickUniformArm(ARMS, 0)).toBe("a");
    expect(pickUniformArm(ARMS, 0.24)).toBe("a");
    expect(pickUniformArm(ARMS, 0.25)).toBe("b");
    expect(pickUniformArm(ARMS, 0.999)).toBe("b");
  });

  it("comes out near the weights over many participants", () => {
    const random = createRandom(11);
    const picks = Array.from({ length: 4000 }, () => pickUniformArm(ARMS, random()));
    const share = picks.filter((pick) => pick === "a").length / picks.length;

    expect(share).toBeGreaterThan(0.22);
    expect(share).toBeLessThan(0.28);
  });
});

describe("blockedArm", () => {
  const sequence = (size: number, seed: number, count: number) =>
    Array.from({ length: count }, (_, position) => blockedArm(ARMS, size, seed, position));

  it("balances every complete block exactly, in proportion to the weights", () => {
    const all = sequence(8, 5, 80);

    for (let block = 0; block < 10; block++) {
      const arms = all.filter((item) => item.block === block).map((item) => item.arm);
      expect(arms).toHaveLength(8);
      expect(arms.filter((arm) => arm === "a")).toHaveLength(2);
      expect(arms.filter((arm) => arm === "b")).toHaveLength(6);
    }
  });

  it("reports the block and position", () => {
    expect(blockedArm(ARMS, 8, 5, 19)).toMatchObject({ block: 2, positionInBlock: 3 });
  });

  it("is reproducible from the seed", () => {
    expect(sequence(8, 5, 40)).toEqual(sequence(8, 5, 40));
  });

  it("orders blocks differently from each other and across seeds", () => {
    const order = (seed: number, block: number) =>
      sequence(8, seed, 8 * (block + 1))
        .filter((item) => item.block === block)
        .map((item) => item.arm)
        .join();

    expect(new Set([order(5, 0), order(5, 1), order(5, 2), order(5, 3)]).size).toBeGreaterThan(1);
    expect(new Set([order(1, 0), order(2, 0), order(3, 0), order(4, 0)]).size).toBeGreaterThan(1);
  });

  it("refuses a block size that can't be balanced", () => {
    expect(() => blockedArm(ARMS, 5, 1, 0)).toThrow("can't be balanced");
  });
});
