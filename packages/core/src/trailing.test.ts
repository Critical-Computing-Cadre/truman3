import { describe, expect, it } from "vitest";
import { withoutTrailing } from "./trailing.ts";

describe("taking characters off the end of text", () => {
  it("takes every one of them off the end, and none from anywhere else", () => {
    expect(withoutTrailing("https://truman.test///", "/")).toBe("https://truman.test");
    expect(withoutTrailing("https://truman.test/a/b", "/")).toBe("https://truman.test/a/b");
    expect(withoutTrailing("@some.name.-.", ".-")).toBe("@some.name");
    expect(withoutTrailing("", "/")).toBe("");
    expect(withoutTrailing("////", "/")).toBe("");
  });

  it("is quick on a long run of the character that isn't at the end", () => {
    const long = `${"/".repeat(200_000)}x`;
    const started = performance.now();
    expect(withoutTrailing(long, "/")).toBe(long);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
