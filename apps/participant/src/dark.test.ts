import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Dark turns the grays around in one place (index.css), so no component says what it looks like in
 * the dark. That only works for colors that one place knows about. A pale wash it doesn't know
 * stays pale, with pale words on it, as an unread message once did.
 */

const css = readFileSync(path.resolve(import.meta.dirname, "index.css"), "utf8");
const dark = css.slice(css.indexOf(':root[data-theme="dark"] {'));
const turnedAround = dark.slice(0, dark.indexOf("}"));

const sources = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      return sources(full);
    }
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
  });

/** Pale backgrounds, and dark words meant for them, in what a participant sees. */
const used = new Set(
  [import.meta.dirname, path.resolve(import.meta.dirname, "../../../packages/ui/src")]
    .flatMap(sources)
    .flatMap((file) => [
      ...readFileSync(file, "utf8").matchAll(
        /\b(?:bg-([a-z]+)-(50|100)|text-([a-z]+)-(700|800|900))\b/g,
      ),
    ])
    .map((match) => `${match[1] ?? match[3]}-${match[2] ?? match[4]}`)
    // The grays are the ones the stylesheet turns around wholesale.
    .filter((color) => !color.startsWith("stone-")),
);

describe("dark, for what a participant sees", () => {
  it("finds the washes and words it's checking", () => {
    expect(used).toContain("amber-50");
  });

  it.each([...used])("turns %s around, so it isn't a pale band with pale words", (color) => {
    expect(turnedAround).toContain(`--color-${color}:`);
  });
});
