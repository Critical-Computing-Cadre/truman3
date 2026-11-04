import { describe, expect, it } from "vitest";
import { ACCENT_PATTERN, contrast, textOnAccent } from "./color.ts";

describe("textOnAccent", () => {
  it("picks whichever of black or white can be read", () => {
    expect(textOnAccent("#000000")).toBe("#ffffff");
    expect(textOnAccent("#ffffff")).toBe("#000000");
    expect(textOnAccent("#ffff00")).toBe("#000000");
    expect(textOnAccent("#1d4ed8")).toBe("#ffffff");
  });

  it("is readable on any color", () => {
    for (let shade = 0; shade < 256; shade += 5) {
      for (const channel of [0, 128, 255]) {
        const part = (value: number) => value.toString(16).padStart(2, "0");
        const color = `#${part(shade)}${part(channel)}${part(255 - shade)}`;
        expect(contrast(color, textOnAccent(color))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("ACCENT_PATTERN", () => {
  it("takes only six-digit colors", () => {
    expect(ACCENT_PATTERN.test("#1d4ED8")).toBe(true);
    for (const bad of ["red", "#fff", "#12345g", "#123456;background:url(x)", "url(x)"]) {
      expect(ACCENT_PATTERN.test(bad)).toBe(false);
    }
  });
});
