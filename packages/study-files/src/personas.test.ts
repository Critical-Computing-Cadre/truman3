import { studyDefinitionSchema, studySettingsSchema, validateStudy } from "@truman3/core";
import { describe, expect, it } from "vitest";
import { parsePersonas } from "./personas.ts";

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

/** What's wrong with some personas, read and then checked against a small study. */
function problems(yaml: string) {
  const { personas, issues } = parsePersonas(yaml);
  if (issues.length > 0) {
    return issues.map(({ message }) => message);
  }
  const study = studyDefinitionSchema.parse({
    settings,
    actors: [],
    posts: [],
    ...(personas ? { personas } : {}),
  });
  return validateStudy(study)
    .filter(({ file }) => file === "personas.yaml")
    .map(({ message }) => message);
}

describe("personas.yaml", () => {
  it("reads personas, with a model to play them by default", () => {
    expect(
      parsePersonas(`
personas:
  - id: shy
    about: Rarely posts.
  - id: bold
    about: Says what they think.
    condition: b
`),
    ).toEqual({
      personas: {
        model: "claude-sonnet-5-5",
        personas: [
          { id: "shy", about: "Rarely posts." },
          { id: "bold", about: "Says what they think.", condition: "b" },
        ],
      },
      issues: [],
    });
  });

  it("names the persona with a problem", () => {
    expect(problems("personas:\n  - id: shy\n")).toEqual([
      'The persona "shy" (about): Invalid input: expected string, received undefined',
    ]);
    expect(problems("personas: [")).toEqual([
      expect.stringMatching(/^This file couldn't be read: /),
    ]);
  });

  it("checks conditions, and that each id is used once", () => {
    expect(
      problems(`
personas:
  - { id: shy, about: Quiet, condition: c }
  - { id: shy, about: Also quiet }
`),
    ).toEqual([
      'The persona "shy" starts in "c", which isn\'t a condition in study.yaml.',
      'There are two personas called "shy". Each needs its own id.',
    ]);
  });
});
