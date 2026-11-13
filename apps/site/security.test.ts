import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const file = readFileSync(
  path.resolve(import.meta.dirname, "public/.well-known/security.txt"),
  "utf8",
);
const field = (name: string) => new RegExp(`^${name}: (.+)$`, "m").exec(file)?.[1];

describe("security.txt (ADR 84)", () => {
  it("says where to write, and where the policy is", () => {
    expect(field("Contact")).toBe("mailto:security@truman-research.org");
    expect(field("Policy")).toBe("https://truman-research.org/security");
    expect(field("Canonical")).toBe("https://truman-research.org/.well-known/security.txt");
  });

  // The standard has a file say when it stops being true, and tools ignore one that's out of date.
  // This fails a month ahead, so the date is moved on before anyone is told the file has lapsed.
  it("doesn't run out within a month, or claim to last more than a year", () => {
    const expires = new Date(field("Expires") as string).getTime();
    const day = 24 * 60 * 60 * 1000;
    expect(expires).toBeGreaterThan(Date.now() + 30 * day);
    expect(expires).toBeLessThan(Date.now() + 366 * day);
  });
});
