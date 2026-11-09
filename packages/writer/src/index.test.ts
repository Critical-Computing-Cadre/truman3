import { describe, expect, it } from "vitest";
import { choiceInstruction, cleanLine, costOf, lineFromChoice, standInWriter } from "./index.ts";

describe("the writer", () => {
  it("keeps only the line, without quotes, within the length allowed", () => {
    expect(cleanLine('  "Hi there!"  ', 100)).toBe("Hi there!");
    expect(cleanLine("“Curly quotes”", 100)).toBe("Curly quotes");
    expect(cleanLine('He said "hi" to me', 100)).toBe('He said "hi" to me');
    expect(cleanLine("abcdefghij", 5)).toBe("abcd…");
  });

  it("prices what's written, and prices a model it doesn't know as the most expensive", () => {
    expect(costOf("claude-opus-5-5", 1_000_000, 0)).toBe(4);
    expect(costOf("claude-opus-5-5", 0, 1_000_000)).toBe(20);
    expect(costOf("some-new-model", 1_000_000, 1_000_000)).toBe(60);
  });

  it("has a stand-in for tests that never calls a model", async () => {
    const writer = standInWriter(({ prompt }) => `Echo: ${prompt}`);
    const written = await writer.write({ model: "m", system: "s", prompt: "hi", maxLength: 50 });
    expect(written).toMatchObject({ text: "Echo: hi", model: "stand-in" });
    expect(writer.calls).toHaveLength(1);
    expect((await writer.check("fine", [], "m")).allowed).toBe(true);
    expect((await writer.check("BLOCK it", [], "m")).allowed).toBe(false);
  });

  it("takes a rehearsed line by its number, or a new line only when that's allowed", () => {
    const lines = ["First", "Second"];
    expect(lineFromChoice({ line: 2, newLine: "" }, lines, false, 50)).toEqual({
      choice: 1,
      text: "Second",
    });
    expect(lineFromChoice({ line: 0, newLine: "Mine" }, lines, true, 50)).toEqual({
      choice: null,
      text: "Mine",
    });
    expect(lineFromChoice({ line: 0, newLine: "Mine" }, lines, false, 50)).toBeNull();
    expect(lineFromChoice({ line: 9, newLine: "" }, lines, true, 50)).toBeNull();
  });

  it("asks a model to prefer rehearsed lines, and to write its own only when allowed", () => {
    const open = choiceInstruction(["Hi!", "Welcome"], true);
    expect(open).toContain("1. Hi!\n2. Welcome");
    expect(open).toContain("even if a line of your own could be more specific");
    expect(open).toContain("Only if every one of them would be wrong or strange here, give 0");
    expect(choiceInstruction(["Hi!"], false)).toContain("One of them has to be used");
  });

  it("has a stand-in that chooses the line that shares a word with what's happening", async () => {
    const writer = standInWriter(() => "A new one");
    const request = { model: "m", system: "s", maxLength: 50 };
    const lines = ["Nice hiking photo!", "Welcome aboard"];
    const choose = (prompt: string, allowNew: boolean) =>
      writer.choose({ ...request, prompt, lines, allowNew });
    expect(await choose("They posted about hiking", false)).toMatchObject({ choice: 0 });
    expect(await choose("Say welcome", false)).toMatchObject({ choice: 1 });
    expect(await choose("Something else", true)).toMatchObject({ choice: null, text: "A new one" });
    expect(await choose("Something else", false)).toMatchObject({ choice: 0 });
    expect((await writer.rehearse({ ...request, prompt: "p", count: 3 })).lines).toHaveLength(3);
  });
});
