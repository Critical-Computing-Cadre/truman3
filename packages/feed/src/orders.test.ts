import { COMMENT_SORTS, FEED_SORTS } from "@truman3/core";
import { describe, expect, it } from "vitest";
import { COMMENT_ORDERS } from "./comment-orders.ts";
import { RANKERS, type RankablePost } from "./rankers.ts";
import { bestScore, controversyScore, hotScore, risingScore } from "./scores.ts";

const HOUR = 60 * 60 * 1000;
const NOW = 1000 * HOUR;
const context = { seed: 1, viewedPostIds: new Set<string>(), nowMs: NOW };

const post = (id: string, hoursOld: number, ups: number, downs: number): RankablePost => ({
  id,
  timeMs: NOW - hoursOld * HOUR,
  position: null,
  score: ups - downs,
  ups,
  downs,
});
const ids = (name: keyof typeof RANKERS, posts: RankablePost[]) =>
  RANKERS[name].rank(posts, context).map(({ id }) => id);

describe("orders a study can choose", () => {
  it("has a ranker and a version for each choice a participant can make", () => {
    for (const sort of FEED_SORTS) {
      expect(RANKERS[sort]).toMatchObject({ name: sort, version: expect.any(String) });
    }
    for (const sort of COMMENT_SORTS) {
      expect(COMMENT_ORDERS[sort]).toMatchObject({ name: sort, version: expect.any(String) });
    }
  });

  it("works out scores the way the codebook says", () => {
    expect(hotScore(27, NOW - 7 * HOUR, NOW)).toBeCloseTo(1);
    expect(risingScore(10, NOW - 4 * HOUR, NOW)).toBe(2);
    expect(controversyScore(10, 5)).toBe(7.5);
    expect(controversyScore(10, 0)).toBe(0);
    expect(bestScore(0, 0)).toBe(0);
    // A published example of the Wilson lower bound at 95%: 1 of 1 is about 0.207.
    expect(bestScore(1, 0)).toBeCloseTo(0.2065, 3);
  });

  it("lets a newer post with a smaller score beat an old one with hot", () => {
    const order = ids("hot", [post("old", 100, 500, 0), post("recent", 1, 50, 0)]);
    expect(order).toEqual(["recent", "old"]);
  });

  it("is cautious about few votes with best", () => {
    const order = ids("best", [post("few", 1, 3, 0), post("many", 1, 300, 10)]);
    expect(order).toEqual(["many", "few"]);
  });

  it("puts many evenly split votes first with controversial", () => {
    const order = ids("controversial", [
      post("agreed", 1, 500, 0),
      post("split", 1, 40, 38),
      post("lopsided", 1, 40, 2),
    ]);
    expect(order).toEqual(["split", "lopsided", "agreed"]);
  });

  it("keeps the last day ahead with rising, however high an older post scored", () => {
    const order = ids("rising", [
      post("older", 30, 5000, 0),
      post("slow", 10, 11, 0),
      post("fast", 1, 10, 0),
    ]);
    expect(order).toEqual(["fast", "slow", "older"]);
  });

  it("gives the same order for the same inputs, whatever order they came in", () => {
    const posts = [post("a", 2, 5, 1), post("b", 3, 9, 2), post("c", 1, 1, 1)];
    for (const name of ["hot", "best", "rising", "controversial"] as const) {
      expect(ids(name, posts)).toEqual(ids(name, [...posts].reverse()));
    }
  });

  it("records the number behind each place", () => {
    const [first] = RANKERS.hot.rank([post("a", 7, 27, 0)], context);
    expect(first?.score).toBeCloseTo(1);
  });

  it("sorts comments by the same ideas", () => {
    const sorted = (name: keyof typeof COMMENT_ORDERS, items: RankablePost[]) =>
      [...items].sort(COMMENT_ORDERS[name].compare).map(({ id }) => id);
    const items = [post("few", 3, 3, 0), post("split", 2, 40, 38), post("many", 1, 300, 10)];
    expect(sorted("best", items)).toEqual(["many", "few", "split"]);
    expect(sorted("controversial", items)[0]).toBe("split");
    expect(sorted("old", items)).toEqual(["few", "split", "many"]);
  });
});
