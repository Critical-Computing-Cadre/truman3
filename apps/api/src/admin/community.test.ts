import { parseBeats } from "@truman3/study-files";
import { describe, expect, it } from "vitest";
import { withCommunity } from "./community.ts";

const community = {
  live: true,
  hold: false,
  own: false,
  capUsd: 0.5,
  about: "Neighbors in a small town, swapping news and recipes.",
  topics: ["road work"],
  postsPerDay: 4,
  repliesPerPost: 2,
  daysBefore: 1,
  daysDuring: 3,
  cast: [],
  neverSay: [],
  conditions: { mode: "same" as const },
};

describe("setting a live community in beats.yaml", () => {
  it("keeps the rest of the file, comments included", () => {
    const text = withCommunity(
      "# Our beats\nlive: { enabled: true } # on for the pilot\nbeats: []\n",
      community,
    );
    expect(text).toContain("# Our beats");
    expect(text).toContain("# on for the pilot");
    const read = parseBeats(text);
    expect(read.issues).toEqual([]);
    expect(read.live.enabled).toBe(true);
    expect(read.community).toMatchObject({ live: true, daysDuring: 3, topics: ["road work"] });
  });

  it("replaces one that's there, and starts a file that's empty", () => {
    const once = withCommunity("", community);
    const twice = withCommunity(once, { ...community, live: false, hold: true });
    expect(twice.match(/^community:/gm)).toHaveLength(1);
    expect(parseBeats(twice).community).toMatchObject({ live: false, hold: true });
  });
});
