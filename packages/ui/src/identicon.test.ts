import { describe, expect, it } from "vitest";
import { identicon } from "./identicon.ts";

describe("identicon", () => {
  it("gives the same username the same picture every time", () => {
    expect(identicon("tiana")).toEqual(identicon("tiana"));
  });

  it("gives similar usernames different pictures", () => {
    const pictures = new Set(
      Array.from({ length: 200 }, (_, i) => JSON.stringify(identicon(`user${i}`))),
    );
    expect(pictures.size).toBe(200);
  });

  it("is mirrored left to right, and stays on the grid", () => {
    for (let i = 0; i < 200; i += 1) {
      const { cells } = identicon(`user${i}`);
      const filled = new Set(cells.map(([column, row]) => `${column},${row}`));
      for (const [column, row] of cells) {
        expect(column).toBeGreaterThanOrEqual(0);
        expect(column).toBeLessThan(5);
        expect(row).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThan(5);
        expect(filled.has(`${4 - column},${row}`)).toBe(true);
      }
    }
  });

  it("never comes out blank", () => {
    expect(identicon("").cells.length).toBeGreaterThan(0);
  });
});
