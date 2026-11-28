import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit.ts";

describe("createRateLimiter", () => {
  it("allows up to the limit, per key", () => {
    const allow = createRateLimiter({ max: 2, windowMs: 1000 });

    expect(allow("a", 0)).toBe(true);
    expect(allow("a", 1)).toBe(true);
    expect(allow("a", 2)).toBe(false);
    expect(allow("b", 3)).toBe(true);
  });

  it("starts over in the next window, measured from each key's own first request", () => {
    const allow = createRateLimiter({ max: 1, windowMs: 1000 });

    expect(allow("a", 0)).toBe(true);
    expect(allow("b", 900)).toBe(true);
    expect(allow("a", 999)).toBe(false);
    expect(allow("a", 1000)).toBe(true);
    // "b" started at 900, so "a" rolling over at 1000 doesn't give "b" a fresh window early.
    expect(allow("b", 1000)).toBe(false);
    expect(allow("b", 1900)).toBe(true);
  });

  it("refuses new keys when it's full, and takes them again once old ones have run out", () => {
    const allow = createRateLimiter({ max: 1, windowMs: 1000 });
    for (let key = 0; key < 10_000; key += 1) {
      expect(allow(`made-up-${key}`, 0)).toBe(true);
    }
    // Full: someone new is refused, which is why callers keep made-up keys out (admin/routes.ts).
    expect(allow("someone-new", 500)).toBe(false);
    expect(allow("someone-new", 1000)).toBe(true);
  });
});
