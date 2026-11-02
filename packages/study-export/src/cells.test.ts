import { describe, expect, it } from "vitest";
import { safeText } from "./cells.ts";

describe("safeText", () => {
  it.each(["=HYPERLINK(1)", "+1", "-1", "@SUM(A1)", "\tx"])("neutralizes %j", (text) => {
    expect(safeText(text)).toBe(`'${text}`);
  });

  it("leaves ordinary text alone, including symbols later on", () => {
    expect(safeText("nice = good")).toBe("nice = good");
  });

  it("treats nothing as empty", () => {
    expect(safeText(null)).toBe("");
    expect(safeText(undefined)).toBe("");
  });
});
