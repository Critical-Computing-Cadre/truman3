import { decisionSchema } from "@truman3/core";
import { describe, expect, it } from "vitest";
import { destination, groupFor } from "./decisions.ts";

const decision = decisionSchema.parse({
  id: "day-2",
  when: { time: "48:00" },
  measure: { posts: { count: "post" }, minutes: { activeMinutes: true } },
  groups: [
    { name: "quiet", if: { posts: { atMost: 0 }, minutes: { atLeast: 5 } }, to: { c: 1, d: 3 } },
    { name: "busy", if: { posts: { atLeast: 3 } }, to: "stay" },
  ],
});

describe("a decision point", () => {
  it("puts someone in the first group whose tests they all pass, including the ends", () => {
    expect(groupFor(decision, { posts: 0, minutes: 5 })?.name).toBe("quiet");
    expect(groupFor(decision, { posts: 0, minutes: 4 })).toBeUndefined();
    expect(groupFor(decision, { posts: 3, minutes: 0 })?.name).toBe("busy");
    expect(groupFor(decision, { posts: 1, minutes: 10 })).toBeUndefined();
  });

  it("draws where they go by weight, with its chance, or keeps them where they are", () => {
    expect(destination({ c: 1, d: 3 }, "a", 0.1)).toEqual({ condition: "c", probability: 0.25 });
    expect(destination({ c: 1, d: 3 }, "a", 0.5)).toEqual({ condition: "d", probability: 0.75 });
    expect(destination("stay", "a", 0.5)).toEqual({ condition: "a", probability: 1 });
    expect(destination(undefined, "a", 0.5)).toEqual({ condition: "a", probability: 1 });
  });
});
