import { describe, expect, it } from "vitest";
import { forwardedAddress } from "./client-address.ts";

describe("forwardedAddress", () => {
  it("finds the visitor by counting back from the proxies we run", () => {
    expect(forwardedAddress("203.0.113.5, 70.132.1.1", 2)).toBe("203.0.113.5");
    expect(forwardedAddress("203.0.113.5", 1)).toBe("203.0.113.5");
  });

  it("ignores what a visitor put in the header themselves", () => {
    expect(forwardedAddress("1.1.1.1, 2.2.2.2, 203.0.113.5, 70.132.1.1", 2)).toBe("203.0.113.5");
  });

  it("doesn't believe the header without proxies, or a header too short to have passed through them", () => {
    expect(forwardedAddress("1.1.1.1", 0)).toBeUndefined();
    expect(forwardedAddress("1.1.1.1", 2)).toBeUndefined();
    expect(forwardedAddress(undefined, 2)).toBeUndefined();
    expect(forwardedAddress("", 2)).toBeUndefined();
  });
});
