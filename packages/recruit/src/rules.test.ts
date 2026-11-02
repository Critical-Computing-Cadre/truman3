import { describe, expect, it } from "vitest";
import { unmetRules } from "./rules.ts";

const activity = { viewedMs: 5 * 60_000, postsSeen: 10, actions: 2 };

describe("approval rules", () => {
  it("passes anyone when there are no rules", () => {
    expect(unmetRules({}, { viewedMs: 0, postsSeen: 0, actions: 0 })).toEqual([]);
  });

  it("passes someone exactly at a limit", () => {
    expect(unmetRules({ minViewMinutes: 5, minPostsSeen: 10, minActions: 2 }, activity)).toEqual(
      [],
    );
  });

  it("says each rule someone missed", () => {
    expect(unmetRules({ minViewMinutes: 6, minPostsSeen: 11, minActions: 3 }, activity)).toEqual([
      "Viewed posts for 5.0 of 6 minutes",
      "Saw 10 of 11 posts",
      "Did 2 of 3 actions",
    ]);
  });
});
