import { describe, expect, it } from "vitest";
import { type StudyDefinition, studyDefinitionSchema } from "./definition.ts";
import { hasErrors, validateStudy } from "./validate.ts";

const HOUR = 3_600_000;

function study(overrides: Partial<Record<keyof StudyDefinition, unknown>> = {}): StudyDefinition {
  return studyDefinitionSchema.parse({
    settings: settings(),
    actors: [{ username: "ann", name: "Ann" }],
    posts: [{ ref: "1", body: "hello", actor: "ann", timeMs: 0 }],
    ...overrides,
  });
}

function settings(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    slug: "demo",
    title: "Demo",
    site: { name: "Demo" },
    length: { days: 2 },
    entry: { idParam: "PID", idLabel: "Prolific ID", source: "prolific" },
    conditions: { assignment: { method: "uniform" }, arms: [{ key: "a" }] },
    feed: { ranker: "chronological", windowHours: 24 },
    flow: [{ step: "feed" }],
    ...overrides,
  };
}

const messages = (definition: StudyDefinition) =>
  validateStudy(definition).map((issue) => issue.message);

describe("studySettingsSchema", () => {
  it("rejects a misspelled setting", () => {
    const result = studyDefinitionSchema.safeParse({
      settings: settings({ feed: { ranker: "shuffle", windowHour: 24 } }),
      actors: [],
      posts: [],
    });
    expect(result.success).toBe(false);
  });

  it("requires the researcher to choose an assignment method", () => {
    const result = studyDefinitionSchema.safeParse({
      settings: settings({ conditions: { arms: [{ key: "a" }] } }),
      actors: [],
      posts: [],
    });
    expect(result.success).toBe(false);
  });

  it("doesn't turn on classic Truman behaviors unless asked", () => {
    const { feed, likes, privacy } = study({
      settings: settings({ feed: { ranker: "chronological" } }),
    }).settings;

    expect(feed.windowHours).toBeUndefined();
    expect(feed.pinOwnPostsMinutes).toBeUndefined();
    expect(feed.removeFlagged).toBe(false);
    expect(feed.removeBlocked).toBe(false);
    expect(likes).toEqual({});
    expect(privacy.storeIpAddress).toBe(false);
  });
});

describe("validateStudy", () => {
  it("accepts a simple valid study", () => {
    expect(validateStudy(study())).toEqual([]);
  });

  it("finds references to things that don't exist", () => {
    const found = messages(
      study({
        posts: [{ ref: "1", body: "hi", actor: "nobody", timeMs: 0, conditions: ["z"] }],
        comments: [{ ref: "1", body: "hi", actor: "ann", post: "99", timeMs: 0 }],
        reactions: [{ on: "post", nth: 0, type: "like", actor: "nobody", afterMs: 0 }],
      }),
    );

    expect(found).toContain(`Post "1" is by "nobody", who isn't in the list of actors.`);
    expect(found).toContain(`Post "1" uses the condition "z", which isn't in study.yaml.`);
    expect(found).toContain(`Comment "1" is on post "99", which doesn't exist.`);
    expect(found).toContain(
      `The reaction to the participant's post #0 is by "nobody", who isn't in the list of actors.`,
    );
  });

  it("finds duplicates", () => {
    const found = messages(
      study({
        actors: [
          { username: "ann", name: "Ann" },
          { username: "ann", name: "Ann 2" },
        ],
        posts: [
          { ref: "1", body: "a", actor: "ann", timeMs: 0 },
          { ref: "1", body: "b", actor: "ann", timeMs: 0 },
        ],
      }),
    );

    expect(found).toContain(`The username "ann" is used by more than one actor.`);
    expect(found).toContain(`The post ID "1" is used more than once.`);
  });

  it("rejects a comment timed before its post", () => {
    const found = messages(
      study({ comments: [{ ref: "1", body: "hi", actor: "ann", post: "1", timeMs: -1 }] }),
    );
    expect(found).toContain(`Comment "1" is timed before the post it's on ("1").`);
  });

  it("checks reaction text against the reaction type", () => {
    const found = messages(
      study({
        reactions: [
          { on: "post", nth: 0, type: "reply", actor: "ann", afterMs: 0 },
          { on: "comment", nth: 1, type: "like", actor: "ann", afterMs: 0, body: "hi" },
        ],
      }),
    );

    expect(found).toContain(
      `The reaction to the participant's post #0 is a reply, but has no text.`,
    );
    expect(found).toContain(
      `The reaction to the participant's comment #1 is a like, so it can't have text.`,
    );
  });

  it("requires block sizes that can be balanced", () => {
    const definition = study({
      settings: settings({
        conditions: {
          assignment: { method: "blocked", blockSize: 5 },
          arms: [{ key: "a" }, { key: "b", weight: 3 }],
        },
      }),
    });
    expect(hasErrors(validateStudy(definition))).toBe(true);

    const balanced = study({
      settings: settings({
        conditions: {
          assignment: { method: "blocked", blockSize: 8 },
          arms: [{ key: "a" }, { key: "b", weight: 3 }],
        },
      }),
      posts: [
        { ref: "1", body: "x", actor: "ann", timeMs: 0, conditions: ["a"] },
        { ref: "2", body: "y", actor: "ann", timeMs: 0, conditions: ["b"] },
      ],
    });
    expect(hasErrors(validateStudy(balanced))).toBe(false);
  });

  it("checks the shape of the flow", () => {
    const found = messages(
      study({
        settings: settings({
          flow: [{ step: "exit" }, { step: "consent", page: "consent.md" }],
        }),
      }),
    );

    expect(found).toContain("The flow needs exactly one feed step.");
    expect(found).toContain("The exit step has to be last in the flow.");
    expect(found).toContain(`The flow uses the page "consent.md", which doesn't exist.`);
  });

  describe("warnings", () => {
    const timing = (timeMs: number, feed: Record<string, unknown> = {}) =>
      validateStudy(
        study({
          settings: settings({ feed: { ranker: "chronological", windowHours: 24, ...feed } }),
          posts: [{ ref: "1", body: "hi", actor: "ann", timeMs }],
        }),
      );

    it("flags posts outside the window at the start, without making them errors", () => {
      const issues = timing(-25 * HOUR);
      expect(issues.map((issue) => issue.severity)).toEqual(["warning"]);
    });

    it("flags posts after the study ends", () => {
      expect(timing(48 * HOUR)[0]?.message).toContain("after the study ends");
    });

    it("accepts posts exactly at the edge of the window", () => {
      expect(timing(-24 * HOUR)).toEqual([]);
    });

    it("doesn't flag old posts when a study has no window", () => {
      expect(
        validateStudy(
          study({
            settings: settings({ feed: { ranker: "chronological" } }),
            posts: [{ ref: "1", body: "hi", actor: "ann", timeMs: -1000 * HOUR }],
          }),
        ),
      ).toEqual([]);
    });

    it("uses the widest window across conditions", () => {
      const definition = study({
        settings: settings({
          conditions: {
            assignment: { method: "uniform" },
            arms: [{ key: "a" }, { key: "b", feed: { windowHours: 72 } }],
          },
        }),
        posts: [{ ref: "1", body: "hi", actor: "ann", timeMs: -48 * HOUR }],
      });
      expect(validateStudy(definition)).toEqual([]);
    });

    it("flags a condition that doesn't differ from the others", () => {
      const definition = study({
        settings: settings({
          conditions: { assignment: { method: "uniform" }, arms: [{ key: "a" }, { key: "b" }] },
        }),
        posts: [{ ref: "1", body: "hi", actor: "ann", timeMs: 0, conditions: ["a"] }],
      });
      expect(messages(definition)).toEqual([
        `Nothing differs for the condition "b": no content targets it and it has no settings of its own.`,
      ]);
    });
  });
});
