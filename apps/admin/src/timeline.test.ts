import { describe, expect, it } from "vitest";
import { describeTime, postsPerBar, postsThatNeverAppear } from "./timeline.ts";

const HOUR = 3_600_000;
const post = (hours: number, conditions: string[] = []) => ({
  offsetMs: hours * HOUR,
  conditions,
});

describe("postsPerBar", () => {
  it("counts posts per hour for a short study", () => {
    const { counts, barMs } = postsPerBar([post(0.5), post(0.9), post(2)], "a", 4 * HOUR);

    expect(barMs).toBe(HOUR);
    expect(counts).toEqual([2, 0, 1, 0]);
  });

  it("uses wider bars for a long study, so they stay readable", () => {
    const { counts, barMs } = postsPerBar([post(5)], "a", 480 * HOUR);

    expect(barMs).toBe(5 * HOUR);
    expect(counts).toHaveLength(96);
    expect(counts[1]).toBe(1);
  });

  it("counts only what this condition sees", () => {
    const posts = [post(0), post(0, ["a"]), post(0, ["b"])];

    expect(postsPerBar(posts, "a", HOUR).counts).toEqual([2]);
  });

  it("leaves out posts before the start and after the end", () => {
    expect(postsPerBar([post(-1), post(5)], "a", 2 * HOUR).counts).toEqual([0, 0]);
  });
});

describe("postsThatNeverAppear", () => {
  it("finds posts past the end and posts already outside the window", () => {
    const posts = [post(0), post(-23), post(-25), post(48), post(100)];

    expect(postsThatNeverAppear(posts, "a", 48 * HOUR, 24)).toBe(3);
  });

  it("only counts the end when there's no window", () => {
    expect(postsThatNeverAppear([post(-1000), post(48)], "a", 48 * HOUR, null)).toBe(1);
  });

  it("ignores posts for other conditions", () => {
    expect(postsThatNeverAppear([post(100, ["b"])], "a", 48 * HOUR, null)).toBe(0);
  });
});

describe("describeTime", () => {
  it.each([
    [0, "Day 1, 0h in"],
    [6 * HOUR, "Day 1, 6h in"],
    [30 * HOUR, "Day 2, 6h in"],
    [1.5 * HOUR, "Day 1, 1h 30m in"],
  ])("describes %d", (elapsed, text) => {
    expect(describeTime(elapsed)).toBe(text);
  });
});
