import { describe, expect, it } from "vitest";
import { atHost, compareCounts } from "./restore-check.ts";

const live = { teams: 12, researchers: 30, studies: 45, participants: 2000, events: 180_000 };

describe("checking a restored copy against the live database", () => {
  it("passes a copy that's the same", () => {
    const { ok, lines } = compareCounts(live, { ...live });
    expect(ok).toBe(true);
    expect(lines.at(-1)).toBe("The copy has what the live database has. The restore worked.");
    expect(lines[0]).toMatch(/^teams\s+live\s+12\s+copy\s+12\s+ok$/);
  });

  it("passes a copy that's a little behind, as a backup from a few minutes ago is", () => {
    expect(compareCounts(live, { ...live, participants: 1990, events: 179_200 }).ok).toBe(true);
  });

  it("passes a small table that differs by a few rows, though that's a big share of it", () => {
    expect(compareCounts({ teams: 3 }, { teams: 1 }).ok).toBe(true);
  });

  it("fails a copy with an empty table that the live database has rows in", () => {
    const { ok, lines } = compareCounts(live, { ...live, researchers: 0 });
    expect(ok).toBe(false);
    expect(lines[1]).toContain("EMPTY in the copy");
    expect(lines.at(-1)).toContain("The copy is missing data.");
  });

  it("fails a copy that's missing a large part of a table", () => {
    const { ok, lines } = compareCounts(live, { ...live, events: 90_000 });
    expect(ok).toBe(false);
    expect(lines[4]).toContain("FAR FEWER in the copy");
  });

  it("fails a copy that doesn't have a table at all", () => {
    const { participants: _, ...without } = live;
    const { ok, lines } = compareCounts(live, without);
    expect(ok).toBe(false);
    expect(lines[3]).toContain("MISSING from the copy");
  });

  it("passes when rows were deleted from the live database meanwhile, and says so", () => {
    const { ok, lines } = compareCounts({ ...live, participants: 1000 }, live);
    expect(ok).toBe(true);
    expect(lines[3]).toContain("the live database has far fewer");
  });

  it("is fine with a database that's empty in both", () => {
    expect(compareCounts({ teams: 0, events: 0 }, { teams: 0, events: 0 }).ok).toBe(true);
  });

  it("reaches the copy with the live database's logins, at the copy's address", () => {
    expect(
      atHost(
        "postgres://truman_app:s3cret@live.example:5432/truman?sslmode=require",
        "copy.example",
      ),
    ).toBe("postgres://truman_app:s3cret@copy.example:5432/truman?sslmode=require");
  });
});
