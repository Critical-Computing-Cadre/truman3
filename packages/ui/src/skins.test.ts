import { readFileSync } from "node:fs";
import path from "node:path";
import { contrast, LAYOUT_ACCENTS, LAYOUT_KEYS } from "@truman3/core";
import { describe, expect, it } from "vitest";
import { skinProps } from "./platform.tsx";

const css = readFileSync(path.resolve(import.meta.dirname, "skins.css"), "utf8");

describe("each kind of site's colors", () => {
  it.each(LAYOUT_KEYS)("%s has the main color the builder says it has", (layout) => {
    const rule = css.slice(css.indexOf(`[data-layout="${layout}"] {`));
    expect(rule.slice(0, rule.indexOf("}"))).toContain(`--accent-base: ${LAYOUT_ACCENTS[layout]};`);
  });

  it.each(LAYOUT_KEYS)("%s's main color can be read on a white page", (layout) => {
    expect(contrast(LAYOUT_ACCENTS[layout], "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("gives every kind of site a different color", () => {
    expect(new Set(Object.values(LAYOUT_ACCENTS)).size).toBe(LAYOUT_KEYS.length);
  });
});

describe("skinProps", () => {
  it("names the layout, and leaves the color to it", () => {
    expect(skinProps({ layout: "forum" })).toEqual({ "data-layout": "forum" });
  });

  it("puts a study's own color on the same element, with what to write on top of it", () => {
    expect(skinProps({ layout: "forum", accent: "#ffe066" })).toEqual({
      "data-layout": "forum",
      style: { "--accent-base": "#ffe066", "--color-on-accent": "#000000" },
    });
  });
});
