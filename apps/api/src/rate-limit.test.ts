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

  it("starts over in the next window", () => {
    const allow = createRateLimiter({ max: 1, windowMs: 1000 });

    expect(allow("a", 0)).toBe(true);
    expect(allow("a", 999)).toBe(false);
    expect(allow("a", 1000)).toBe(true);
  });
});
