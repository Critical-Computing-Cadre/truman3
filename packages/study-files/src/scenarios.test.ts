import { studyDefinitionSchema, studySettingsSchema, validateStudy } from "@truman3/core";
import { describe, expect, it } from "vitest";
import { parseBeats } from "./beats.ts";
import { parseScenarios } from "./scenarios.ts";

const settings = studySettingsSchema.parse({
  schemaVersion: 1,
  slug: "s",
  title: "S",
  site: { name: "S" },
  length: { days: 1 },
  entry: { idParam: "PID", idLabel: "ID", source: "test" },
  conditions: { assignment: { method: "uniform" }, arms: [{ key: "a" }, { key: "b" }] },
  platform: { style: "mixed", template: "classic" },
  flow: [{ step: "feed" }],
});

const messages = (yaml: string) => parseScenarios(yaml).issues.map(({ message }) => message);

/** What's wrong with a set of scenarios, checked against a small study with one beat. */
function problems(yaml: string) {
  const { scenarios, issues } = parseScenarios(yaml);
  if (issues.length > 0) {
    return issues.map(({ message }) => message);
  }
  const { beats } = parseBeats(`
beats:
  - { id: hi, when: { time: "0:01" }, do: { action: post, actor: ann, text: Hi } }
`);
  const study = studyDefinitionSchema.parse({
    settings,
    actors: [{ username: "ann", name: "Ann", conditions: [] }],
    posts: [
      { ref: "p1", body: "Hi", actor: "ann", timeMs: 0, pictures: [], likes: 0, conditions: [] },
    ],
    beats,
    scenarios,
  });
  return validateStudy(study)
    .filter(({ file }) => file === "scenarios.yaml")
    .map(({ message }) => message);
}

describe("scenarios.yaml", () => {
  it("reads steps with their times, and what to expect", () => {
    const { scenarios, issues } = parseScenarios(`
scenarios:
  - name: Ann says hi
    condition: a
    steps:
      - { at: "0:01", comment: Hello!, on: { post: p1 } }
      - { at: "0:05", expect: { happened: [hi], sees: [Hi] } }
`);
    expect(issues).toEqual([]);
    expect(scenarios[0]?.steps).toEqual([
      { at: 60_000, comment: "Hello!", on: { post: "p1" } },
      {
        at: 300_000,
        expect: { happened: ["hi"], notHappened: [], sees: ["Hi"], doesNotSee: [] },
      },
    ]);
  });

  it("names the scenario and step that's wrong", () => {
    expect(
      messages(`
scenarios:
  - name: Mixed up
    condition: a
    steps:
      - { at: "0:01", post: Hi, like: { post: p1 } }
      - { at: "soon", post: Hi }
      - { at: "0:03", comment: Hi }
`),
    ).toEqual([
      'The scenario "Mixed up", step 1: Give exactly one of post, comment, like, repost, flag, follow, message, expect in a step.',
      'The scenario "Mixed up", step 2 (at): "soon" isn\'t a time. Use hours:minutes, like 0:05.',
      'The scenario "Mixed up", step 3: A comment needs on, and only a comment has it.',
    ]);
  });

  it("has to name conditions, beats, posts, and people that are in the study", () => {
    expect(
      problems(`
scenarios:
  - name: Wrong names
    condition: c
    steps:
      - { at: "0:01", like: { post: p9 } }
      - { at: "0:02", follow: zed }
      - { at: "0:03", comment: Hi, on: { beat: nope } }
      - { at: "0:04", expect: { happened: [hi, gone], condition: d } }
`),
    ).toEqual([
      'The scenario "Wrong names" starts in "c", which isn\'t a condition in study.yaml.',
      'The scenario "Wrong names", step 1, uses the post "p9", which isn\'t in this study.',
      'The scenario "Wrong names", step 2, follows "zed", who isn\'t in the list of actors.',
      'The scenario "Wrong names", step 3, uses what "nope" made, but there\'s no beat called that.',
      'The scenario "Wrong names", step 4, expects "gone", which isn\'t a beat or decision point.',
      'The scenario "Wrong names", step 4, expects the condition "d", which isn\'t in study.yaml.',
    ]);
  });
});
