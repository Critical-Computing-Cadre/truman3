import { studyDefinitionSchema, studySettingsSchema, validateStudy } from "@truman3/core";
import { describe, expect, it } from "vitest";
import { parseBeats } from "./beats.ts";

const settings = studySettingsSchema.parse({
  schemaVersion: 1,
  slug: "s",
  title: "S",
  site: { name: "S" },
  length: { days: 1 },
  entry: { idParam: "PID", idLabel: "ID", source: "test" },
  conditions: { assignment: { method: "uniform" }, arms: [{ key: "a" }, { key: "b" }] },
  platform: { style: "mixed", template: "classic", features: { threads: true } },
  flow: [{ step: "feed" }],
});

/** The problems a set of beats has, read and checked with a small study. */
function problems(yaml: string) {
  const { beats, issues } = parseBeats(yaml);
  if (issues.length > 0) {
    return issues.map(({ message }) => message);
  }
  const study = studyDefinitionSchema.parse({
    settings,
    actors: [
      { username: "ann", name: "Ann", conditions: [] },
      { username: "bob", name: "Bob", conditions: [] },
    ],
    posts: [
      { ref: "p1", body: "Hi", actor: "ann", timeMs: 0, pictures: [], likes: 0, conditions: [] },
    ],
    beats,
  });
  return validateStudy(study)
    .filter(({ file }) => file === "beats.yaml")
    .map(({ severity, message }) => `${severity}: ${message}`);
}

describe("reading beats", () => {
  it("turns times and delays into milliseconds, with sensible defaults", () => {
    const { beats, issues } = parseBeats(`
beats:
  - id: early
    when: { time: "0:05" }
    do: { action: post, actor: ann, text: Hello }
  - id: later
    when: { beat: early }
    delay: { min: "0:01", max: "0:03" }
    do: { action: like, actor: bob, on: { beat: early } }
`);
    expect(issues).toEqual([]);
    expect(beats[0]).toMatchObject({
      when: { time: 5 * 60_000 },
      delay: { minMs: 0, maxMs: 0 },
      max: 1,
      unless: [],
      conditions: [],
    });
    expect(beats[1]?.delay).toEqual({ minMs: 60_000, maxMs: 180_000 });
  });

  it("names the beat and what's wrong with it", () => {
    expect(
      parseBeats(`
beats:
  - id: oops
    when: { time: "soon" }
    do: { action: post, actor: ann, text: Hi }
`).issues.map(({ message }) => message),
    ).toEqual(['The beat "oops" (when.time): "soon" isn\'t a time. Use hours:minutes, like 0:05.']);
    expect(parseBeats("beats: [{ when: { time: '0:01' } }]").issues[0]?.message).toMatch(/^Beat 1/);
    expect(parseBeats("beats: [").issues[0]?.message).toMatch(/couldn't be read/);
  });

  it("accepts an empty file", () => {
    expect(parseBeats("")).toMatchObject({ beats: [], issues: [], cast: {} });
  });
});

describe("checking beats", () => {
  it("passes a set of beats that fit together", () => {
    expect(
      problems(`
beats:
  - id: mock
    when: { time: "0:03" }
    do: { action: comment, actor: bob, on: { post: p1 }, text: lol }
  - id: answer
    when: { participant: comment, under: mock }
    do: { action: comment, actor: bob, on: trigger, text: relax }
  - id: defend
    conditions: [a]
    when: { beat: mock }
    unless: [answer]
    do: { action: comment, actor: ann, on: { post: p1 }, text: Not cool }
`),
    ).toEqual([]);
  });

  it("finds people, posts, beats, and conditions that aren't there", () => {
    expect(
      problems(`
beats:
  - id: one
    conditions: [z]
    when: { beat: nope }
    unless: [missing]
    do: { action: comment, actor: carl, on: { post: p9 }, text: Hi }
`),
    ).toEqual([
      'error: The beat "one" is done by "carl", who isn\'t in the list of actors.',
      'error: The beat "one" uses the condition "z", which isn\'t in study.yaml.',
      'error: The beat "one" comes after "nope", which isn\'t a beat in this study.',
      'error: The beat "one" acts on the post "p9", which isn\'t in this study.',
      'error: The beat "one" is skipped after "missing", which isn\'t a beat in this study.',
    ]);
  });

  it("refuses beats that follow each other in a circle", () => {
    const found = problems(`
beats:
  - { id: a, when: { beat: b }, do: { action: post, actor: ann, text: A } }
  - { id: b, when: { beat: a }, do: { action: post, actor: ann, text: B } }
`);
    expect(found.some((message) => message.includes("go round in a circle"))).toBe(true);
  });

  it("refuses an id used twice", () => {
    expect(
      problems(`
beats:
  - { id: b, when: { time: "0:01" }, do: { action: post, actor: ann, text: B } }
  - { id: b, when: { time: "0:02" }, do: { action: post, actor: ann, text: C } }
`),
    ).toEqual(['error: The beat id "b" is used more than once.']);
  });

  it("says when a trigger is missing or has two kinds", () => {
    expect(
      parseBeats(`
beats:
  - { id: both, when: { time: "0:01", beat: x }, do: { action: post, actor: ann, text: B } }
`).issues.map(({ message }) => message),
    ).toEqual(['The beat "both" (when): Give exactly one of time, participant, or beat.']);
  });

  it("refuses acting on what set it off when that's only a time, and a backward delay", () => {
    expect(
      problems(`
beats:
  - id: when-alone
    when: { time: "0:01" }
    delay: { min: "0:05", max: "0:01" }
    do: { action: like, actor: ann, on: trigger }
`),
    ).toEqual([
      'error: The beat "when-alone" acts on what set it off, but a time doesn\'t point at anything.',
      'error: The beat "when-alone" has a delay whose min is after its max.',
    ]);
  });

  it("warns when a beat needs a feature that's off, or comes after the study ends", () => {
    expect(
      problems(`
beats:
  - { id: share, when: { time: "30:00" }, do: { action: repost, actor: ann, on: { post: p1 } } }
`),
    ).toEqual([
      'warning: The beat "share" is set for after the study ends, so it won\'t happen.',
      'warning: The beat "share" needs reposts, which is off in "a", so it won\'t happen there.',
      'warning: The beat "share" needs reposts, which is off in "b", so it won\'t happen there.',
    ]);
  });

  it("needs a fallback for an improvised line, and either text or improvise", () => {
    const messages = (yaml: string) => parseBeats(yaml).issues.map(({ message }) => message);
    expect(
      messages(`
beats:
  - { id: a, when: { time: "0:01" }, do: { action: post, actor: ann, improvise: Say hi } }
`),
    ).toEqual([
      'The beat "a" (do): An improvised line needs a fallback line, for when live writing can\'t be used.',
    ]);
    expect(
      messages(`
beats:
  - { id: b, when: { time: "0:01" }, do: { action: post, actor: ann } }
`),
    ).toEqual(['The beat "b" (do): Give either text or improvise.']);
  });

  it("reads live writing settings and persona cards, with live writing off by default", () => {
    const off = parseBeats("beats: []");
    expect(off.live).toMatchObject({
      enabled: false,
      budgetUsd: 5,
      model: "claude-opus-5-5",
      maxLength: 500,
      redLines: [],
    });
    const on = parseBeats(`
live: { enabled: true, budgetUsd: 2 }
cast:
  ann: { voice: Cheerful, redLines: [No politics] }
beats: []
`);
    expect(on.live).toMatchObject({ enabled: true, budgetUsd: 2 });
    expect(on.cast.ann).toEqual({ voice: "Cheerful", redLines: ["No politics"] });
  });

  it("warns when lines improvise but live writing is off, and checks persona cards", () => {
    const { beats, live, cast } = parseBeats(`
cast:
  carl: { voice: Grumpy }
  ann: { relationships: { zed: rivals, participant: friendly } }
beats:
  - id: hi
    when: { time: "0:01" }
    do: { action: post, actor: ann, improvise: Say hi, fallback: Hi! }
`);
    const study = studyDefinitionSchema.parse({
      settings,
      actors: [{ username: "ann", name: "Ann", conditions: [] }],
      posts: [],
      beats,
      christof: { live, cast },
    });
    expect(
      validateStudy(study)
        .filter(({ file }) => file === "beats.yaml")
        .map(({ severity, message }) => `${severity}: ${message}`),
    ).toEqual([
      "error: There's a persona card for \"carl\", who isn't in the list of actors.",
      'warning: ann\'s persona card mentions "zed", who isn\'t in the list of actors. Use "participant" for whoever takes part.',
      'warning: Live writing is off, so the beat "hi" uses its fallback line. Turn it on with live: { enabled: true } in beats.yaml.',
    ]);
  });

  it("reads rehearsed lines, only on improvised beats, and doesn't warn about live writing for them", () => {
    expect(
      problems(`
beats:
  - id: hi
    when: { time: "0:01" }
    do: { action: post, actor: ann, improvise: Say hi, fallback: Hi!, lines: [Hello, Hey] }
`),
    ).toEqual([]);
    expect(
      parseBeats(`
beats:
  - { id: a, when: { time: "0:01" }, do: { action: post, actor: ann, text: Hi, lines: [Hey] } }
`).issues.map(({ message }) => message),
    ).toEqual(['The beat "a" (do): Rehearsed lines only go with improvise.']);
    expect(parseBeats("beats: []").live.stray).toBe("choose");
    expect(parseBeats("live: { stray: never }\nbeats: []").live.stray).toBe("never");
  });

  it("reads approval settings: none by default, ten minutes to wait, or never", () => {
    expect(parseBeats("beats: []").live).toMatchObject({
      approval: "none",
      approvalTimeout: 10 * 60_000,
    });
    expect(parseBeats('live: { approval: all, approvalTimeout: "0:02" }').live).toMatchObject({
      approval: "all",
      approvalTimeout: 2 * 60_000,
    });
    expect(parseBeats("live: { approvalTimeout: never }").live.approvalTimeout).toBeNull();
    const [beat] = parseBeats(`
beats:
  - { id: a, approve: true, when: { time: "0:01" }, do: { action: post, actor: ann, text: Hi } }
`).beats;
    expect(beat?.approve).toBe(true);
  });

  describe("decision points", () => {
    const adaptive = studySettingsSchema.parse({
      ...settings,
      conditions: {
        assignment: { method: "uniform" },
        arms: [{ key: "a" }, { key: "b" }, { key: "c", weight: 0 }, { key: "d", weight: 0 }],
      },
    });
    const decisionProblems = (yaml: string) => {
      const { beats, issues, live, cast, decide } = parseBeats(yaml);
      if (issues.length > 0) {
        return issues.map(({ message }) => message);
      }
      const study = studyDefinitionSchema.parse({
        settings: adaptive,
        actors: [{ username: "ann", name: "Ann", conditions: [] }],
        posts: [],
        beats,
        christof: { live, cast, decide },
      });
      return validateStudy(study)
        .filter(({ file }) => file === "beats.yaml")
        .map(({ severity, message }) => `${severity}: ${message}`);
    };

    it("passes a SMART design: non-responders re-randomized, responders stay", () => {
      expect(
        decisionProblems(`
beats:
  - { id: nudge, when: { beat: day-2 }, conditions: [c], do: { action: post, actor: ann, text: Hi } }
decide:
  - id: day-2
    when: { time: "48:00" }
    conditions: [a]
    measure:
      posts: { count: post }
      opened: { count: content.opened, within: "24:00" }
      minutes: { activeMinutes: true }
      nudged: { fired: nudge }
    groups:
      - { name: quiet, if: { posts: { atMost: 0 }, minutes: { atLeast: 1 } }, to: { c: 1, d: 1 } }
      - { name: active, to: stay }
`),
      ).toEqual([
        'warning: The decision point "day-2" is set for after the study ends, so it won\'t happen.',
      ]);
    });

    it("refuses moving anyone back to where people start, and tests of measures it doesn't take", () => {
      expect(
        decisionProblems(`
decide:
  - id: back
    when: { time: "1:00" }
    conditions: [c]
    groups:
      - { name: all, if: { posts: { atLeast: 1 } }, to: { a: 1, c: 1 } }
`),
      ).toEqual([
        'error: The decision point "back"\'s group "all" tests posts, which isn\'t in its measure.',
        'error: The decision point "back" moves people to "a", where people start. Move them only to conditions with weight 0, or among the conditions it\'s for, so nobody goes back.',
        'warning: The condition "d" has weight 0, and no decision point moves anyone there, so nobody will be in it.',
      ]);
    });

    it("names what can be counted, and needs a group", () => {
      expect(
        decisionProblems(`
decide:
  - id: x
    when: { time: "1:00" }
    measure: { n: { count: dances } }
    groups: []
`),
      ).toEqual([
        'The decision point "x" (measure.n.count): Count one of post, comment, like, repost, follow, flag, or an event type like content.opened.',
        'The decision point "x" (groups): Give at least one group.',
      ]);
    });

    it("lets a beat follow a decision point, but not act on what it made", () => {
      expect(
        decisionProblems(`
beats:
  - { id: r, when: { beat: d1 }, do: { action: like, actor: ann, on: trigger } }
decide:
  - { id: d1, when: { time: "1:00" }, groups: [{ name: all, to: { c: 1, d: 1 } }] }
`),
      ).toEqual([
        'error: The beat "r" acts on what set it off, but a decision point doesn\'t make anything.',
      ]);
    });
  });
});
