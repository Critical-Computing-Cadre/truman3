import { describe, expect, it } from "vitest";
import { hasHashtag, textPieces } from "./post-text.ts";

const both = { hashtags: true, mentions: true };

describe("textPieces", () => {
  it("finds hashtags and mentions among plain text", () => {
    expect(textPieces("Hi @ann, see #News now", both)).toEqual([
      { type: "text", text: "Hi " },
      { type: "mention", text: "@ann", username: "ann" },
      { type: "text", text: ", see " },
      { type: "tag", text: "#News", tag: "news" },
      { type: "text", text: " now" },
    ]);
  });

  it("leaves out what's off, and what's only part of a word", () => {
    expect(textPieces("#a @b", { hashtags: false, mentions: false })).toEqual([
      { type: "text", text: "#a @b" },
    ]);
    expect(textPieces("me@example.com and a#b", both)).toEqual([
      { type: "text", text: "me@example.com and a#b" },
    ]);
  });

  it("doesn't take the end of a sentence with a mention", () => {
    expect(textPieces("Thanks @ann.", both)).toEqual([
      { type: "text", text: "Thanks " },
      { type: "mention", text: "@ann", username: "ann" },
      { type: "text", text: "." },
    ]);
  });

  it("keeps every character", () => {
    const text = "(#one) #two, @three! niño #año";
    expect(
      textPieces(text, both)
        .map((piece) => piece.text)
        .join(""),
    ).toBe(text);
  });
});

describe("hasHashtag", () => {
  it("ignores case and a leading #", () => {
    expect(hasHashtag("Big #NEWS today", "#news")).toBe(true);
    expect(hasHashtag("Big #newsroom today", "news")).toBe(false);
  });
});
