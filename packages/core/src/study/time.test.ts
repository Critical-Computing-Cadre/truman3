import { describe, expect, it } from "vitest";
import { formatStudyTime, parseStudyTime } from "./time.ts";

describe("parseStudyTime", () => {
  it.each([
    ["0:00", 0],
    ["0:04", 4 * 60_000],
    ["2:05", 2 * 3_600_000 + 5 * 60_000],
    ["100:00", 100 * 3_600_000],
    ["1:00:30", 3_600_000 + 30_000],
    [" 0:01 ", 60_000],
  ])("reads %s", (text, expected) => {
    expect(parseStudyTime(text)).toBe(expected);
  });

  it("treats a leading minus as before the participant arrived", () => {
    expect(parseStudyTime("-20:35")).toBe(-(20 * 3_600_000 + 35 * 60_000));
    expect(parseStudyTime("-0:05")).toBe(-5 * 60_000);
  });

  it("treats -0:00 as zero", () => {
    expect(parseStudyTime("-0:00")).toBe(0);
  });

  it.each(["", "5", "2:5", "2:60", "a:bc", "1:00:60", "1.5:00"])("rejects %j", (text) => {
    expect(parseStudyTime(text)).toBeNull();
  });
});

describe("formatStudyTime", () => {
  it.each([
    [0, "0:00"],
    [4 * 60_000, "0:04"],
    [2 * 3_600_000 + 5 * 60_000, "2:05"],
    [-(20 * 3_600_000 + 35 * 60_000), "-20:35"],
    [-5 * 60_000, "-0:05"],
  ])("writes %d", (ms, text) => {
    expect(formatStudyTime(ms)).toBe(text);
    expect(parseStudyTime(text)).toBe(ms);
  });
});
