import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_PAGES, guideFor } from "./guide-links.ts";

const SITE = path.resolve(import.meta.dirname, "../../site");
const routes = [
  ...readFileSync(path.resolve(import.meta.dirname, "main.tsx"), "utf8").matchAll(
    /^\s*path: "([^"]+)",$/gm,
  ),
].map((match) => match[1] as string);

describe("help for each page", () => {
  it("finds this app's routes", () => {
    expect(routes.length).toBeGreaterThan(15);
    expect(routes).toContain("/drafts/$draftId/beats");
  });

  it("has a guide page for every route", () => {
    expect(routes.filter((route) => !(route in GUIDE_PAGES))).toEqual([]);
  });

  it("lists no route that's gone", () => {
    expect(Object.keys(GUIDE_PAGES).filter((route) => !routes.includes(route))).toEqual([]);
  });

  it("links only to pages the site has, by the title they have", () => {
    for (const { page, about } of Object.values(GUIDE_PAGES)) {
      const file = path.join(SITE, `${page}.md`);
      expect(existsSync(file), `${page} isn't a page of the site`).toBe(true);
      const title = /^# (.+)$/m.exec(readFileSync(file, "utf8"))?.[1];
      expect(title, `${page} is titled differently`).toBe(about);
    }
  });

  it("falls back to the guide's first page", () => {
    expect(guideFor("/somewhere-new")).toEqual({
      href: "https://truman-research.org/guide/",
      about: "What Truman is",
    });
    expect(guideFor("/drafts/$draftId/beats").href).toBe("https://truman-research.org/guide/beats");
  });
});
