import { parseBeats } from "@truman3/study-files";
import { describe, expect, it } from "vitest";
import { withLines } from "./rehearse.ts";

const BEATS = `# Comments are the researcher's, and stay.
live: { enabled: true }
beats:
  - id: welcome # the first reply
    when: { participant: post, nth: 0 }
    do:
      action: comment
      actor: ann
      on: trigger
      improvise: Welcome them
      fallback: Welcome!
  - id: later
    when: { time: "0:03" }
    do: { action: post, actor: ann, improvise: Say hi, fallback: Hi }
`;

describe("rehearsed lines in beats.yaml", () => {
  it("are added to one beat, keeping the rest of the file and its comments", () => {
    const text = withLines(BEATS, "welcome", ["Hey there!", "So glad you're here: welcome"]);
    expect(text).toContain("# Comments are the researcher's, and stay.");
    expect(text).toContain("- id: welcome # the first reply");
    expect(text).toContain("do: { action: post, actor: ann, improvise: Say hi, fallback: Hi }");
    const { beats, issues } = parseBeats(text);
    expect(issues).toEqual([]);
    const welcome = beats.find(({ id }) => id === "welcome")?.do;
    expect(welcome && "lines" in welcome && welcome.lines).toEqual([
      "Hey there!",
      "So glad you're here: welcome",
    ]);
  });

  it("replace what the beat had, so lines already there are passed in again", () => {
    const once = withLines(BEATS, "welcome", ["One"]);
    const twice = withLines(once, "welcome", ["One", "Two"]);
    const welcome = parseBeats(twice).beats[0]?.do;
    expect(welcome && "lines" in welcome && welcome.lines).toEqual(["One", "Two"]);
  });

  it("can't go on a beat that isn't there", () => {
    expect(() => withLines(BEATS, "missing", ["One"])).toThrow("no beat called missing");
  });
});
