import { describe, expect, it } from "vitest";
import {
  describeOffset,
  describeTime,
  layoutMarkers,
  postPlacement,
  postsPerBar,
  postsThatNeverAppear,
  timeAtFraction,
  timelineRange,
} from "./timeline.ts";

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

describe("timelineRange", () => {
  it("covers the study and the feed window before it", () => {
    expect(timelineRange([post(1)], 48 * HOUR, 24)).toEqual({
      startMs: -24 * HOUR,
      endMs: 48 * HOUR,
    });
  });

  it("stretches to include posts outside the study, so they can be reached", () => {
    expect(timelineRange([post(-76), post(70)], 48 * HOUR, 24)).toEqual({
      startMs: -76 * HOUR,
      endMs: 70 * HOUR,
    });
  });

  it("has no time before the start without a window or earlier posts", () => {
    expect(timelineRange([], 48 * HOUR, null).startMs).toBe(0);
  });
});

describe("timeAtFraction", () => {
  const range = { startMs: -10 * HOUR, endMs: 10 * HOUR };

  it("finds the time along the line", () => {
    expect(timeAtFraction(0, range)).toBe(-10 * HOUR);
    expect(timeAtFraction(0.5, range)).toBe(0);
    expect(timeAtFraction(1, range)).toBe(10 * HOUR);
  });

  it("rounds to tidy times", () => {
    expect(timeAtFraction(0.5001, range) % (5 * 60_000)).toBe(0);
  });

  it("stays on the line when the pointer goes past the ends", () => {
    expect(timeAtFraction(-1, range)).toBe(-10 * HOUR);
    expect(timeAtFraction(2, range)).toBe(10 * HOUR);
  });
});

describe("postPlacement", () => {
  it.each([
    [-25, "early"],
    [-24, "ok"],
    [0, "ok"],
    [47, "ok"],
    [48, "late"],
    [100, "late"],
  ])("a post at hour %d is %s", (hours, expected) => {
    expect(postPlacement(hours * HOUR, 48 * HOUR, 24)).toBe(expected);
  });

  it("has nothing too early without a window", () => {
    expect(postPlacement(-1000 * HOUR, 48 * HOUR, null)).toBe("ok");
  });
});

describe("layoutMarkers", () => {
  const range = { startMs: 0, endMs: 100 * HOUR };
  const item = (id: string, hours: number) => ({ id, offsetMs: hours * HOUR });

  it("puts each post at its time", () => {
    expect(layoutMarkers([item("a", 50)], range)).toEqual([{ id: "a", left: 50, row: 0 }]);
  });

  it("stacks posts that would overlap, and shares a row when they wouldn't", () => {
    const rows = Object.fromEntries(
      layoutMarkers([item("a", 10), item("b", 10.1), item("c", 50)], range).map(({ id, row }) => [
        id,
        row,
      ]),
    );
    expect(rows).toEqual({ a: 0, b: 1, c: 0 });
  });

  it("doesn't grow forever when many posts land together", () => {
    const many = Array.from({ length: 50 }, (_, i) => item(`p${i}`, 10));
    const rows = layoutMarkers(many, range).map(({ row }) => row);
    expect(Math.max(...rows)).toBe(9);
  });
});

describe("describeOffset", () => {
  it("says how long before they start", () => {
    expect(describeOffset(-1.5 * HOUR)).toBe("1h 30m before they start");
  });

  it("uses the study's time after that", () => {
    expect(describeOffset(6 * HOUR)).toBe("Day 1, 6h in");
  });
});
