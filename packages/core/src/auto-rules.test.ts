import { describe, expect, it } from "vitest";
import { ruleMatches, ruleTerms } from "./auto-rules.ts";

describe("ruleMatches", () => {
  it("matches whole words and phrases, ignoring case", () => {
    expect(ruleMatches("idiot", "What an IDIOT!")).toBe(true);
    expect(ruleMatches("idiot", "idiots")).toBe(false);
    expect(ruleMatches("go away", "please Go   Away now")).toBe(true);
    expect(ruleMatches("go away", "go, away")).toBe(false);
  });

  it("takes several, separated by |, and * for the start of a word", () => {
    expect(ruleMatches("cat|dog", "my dog")).toBe(true);
    expect(ruleMatches("hat*", "such hatred")).toBe(true);
    expect(ruleMatches("hat*", "that")).toBe(false);
  });

  it("treats anything else as plain text", () => {
    expect(ruleMatches("a.c", "abc")).toBe(false);
    expect(ruleMatches("(a+)+$", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!")).toBe(false);
    expect(ruleMatches("c++", "I write c++ daily")).toBe(true);
  });

  it("works beyond English", () => {
    expect(ruleMatches("niño", "el NIÑO corre")).toBe(true);
    expect(ruleMatches("niño", "niños")).toBe(false);
  });

  it("ignores blanks", () => {
    expect(ruleTerms(" a | |*| b ")).toEqual(["a", "b"]);
    expect(ruleMatches("", "anything")).toBe(false);
  });
});
