import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.resolve(import.meta.dirname, "..");

// A deployed Truman publishes this app's index.html and its assets folder, and nothing else
// (infra/lib/truman-stack.ts). A file in public/ is copied beside index.html, where it's never
// published, so asking for it gets the app's page back. The tab's icon went missing that way.
describe("files the page needs", () => {
  it("keeps nothing in a public folder, whose files a deployed Truman wouldn't serve", () => {
    const folder = path.join(APP, "public");
    expect(existsSync(folder) ? readdirSync(folder) : []).toEqual([]);
  });

  it("takes its icon from src, so the build puts it in assets", () => {
    const page = readFileSync(path.join(APP, "index.html"), "utf8");
    const icon = /<link rel="icon"[^>]*href="([^"]+)"/.exec(page)?.[1];
    expect(icon).toMatch(/^\/src\//);
    expect(existsSync(path.join(APP, icon ?? ""))).toBe(true);
  });
});
