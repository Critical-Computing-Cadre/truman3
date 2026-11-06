import { describe, expect, it } from "vitest";
import { cleanLine, costOf, standInWriter } from "./index.ts";

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
});
