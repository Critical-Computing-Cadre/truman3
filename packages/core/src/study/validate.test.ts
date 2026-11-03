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

  it("checks what exit and decline links can fill in", () => {
    const found = messages(
      study({
        settings: settings({
          flow: [
            { step: "feed" },
            { step: "exit", redirect: "https://survey.example.com/s?id={prolificId}" },
          ],
        }),
      }),
    );
    expect(found.join()).toContain("uses {prolificId}");
  });

  it("warns when an exit link wouldn't identify anyone", () => {
    const exitTo = (redirect: string) =>
      messages(
        study({ settings: settings({ flow: [{ step: "feed" }, { step: "exit", redirect }] }) }),
      );

    expect(exitTo("https://survey.example.com/s").join()).toContain("{externalId}");
    expect(exitTo("https://survey.example.com/s?PROLIFIC_PID={externalId}")).toEqual([]);
  });

  it("warns when reshuffling is asked for but nothing shuffles", () => {
    expect(
      messages(
        study({
          settings: settings({ feed: { ranker: "chronological", reshuffleEachVisit: true } }),
        }),
      ).join(),
    ).toContain("reshuffleEachVisit");
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

describe("content for a feature that's off", () => {
  const withFeaturesOff = (features: object) =>
    settings({
      conditions: {
        assignment: { method: "uniform" },
        arms: [{ key: "a" }, { key: "b", platform: { features } }],
      },
    });
  const comment = { ref: "c1", body: "Hi", actor: "ann", post: "p1", timeMs: 0, conditions: [] };
  const reaction = (type: string, on = "post") => ({
    on,
    nth: 0,
    type,
    actor: "ann",
    afterMs: 0,
    conditions: [],
  });

  it("warns that written comments won't show", () => {
    const found = messages(
      study({ settings: withFeaturesOff({ comments: false }), comments: [comment] }),
    );
    expect(found).toContain('Comments are off in "b", so 1 written comments won\'t show there.');
  });

  it("warns that scripted reactions won't happen", () => {
    const found = messages(
      study({
        settings: withFeaturesOff({ likes: false, posting: false }),
        reactions: [reaction("like")],
      }),
    );
    expect(found).toContain('Likes are off in "b", so its scripted likes won\'t happen.');
    expect(found).toContain(
      'Writing posts is off in "b", so reactions to their posts can\'t happen.',
    );
  });

  it("says nothing when the content only applies to a condition that has the feature", () => {
    const found = messages(
      study({
        settings: withFeaturesOff({ comments: false }),
        comments: [{ ...comment, conditions: ["a"] }],
      }),
    );
    expect(found.join()).not.toContain("Comments are off");
  });
});

describe("replies to replies", () => {
  const comment = (ref: string, overrides: Record<string, unknown> = {}) => ({
    ref,
    body: "text",
    actor: "ann",
    post: "1",
    timeMs: 10,
    ...overrides,
  });
  const threads = (on: boolean) =>
    settings({ platform: { style: "mixed", features: { threads: on } } });

  it("accepts a reply to a comment on the same post", () => {
    const definition = study({
      settings: threads(true),
      comments: [comment("a"), comment("b", { replyTo: "a" })],
    });
    expect(hasErrors(validateStudy(definition))).toBe(false);
  });

  it.each([
    ["a comment that doesn't exist", [comment("b", { replyTo: "nope" })], /doesn't exist/],
    [
      "a comment on another post",
      [comment("a", { post: "2" }), comment("b", { replyTo: "a" })],
      /on another post/,
    ],
    [
      "a comment that comes later",
      [comment("a", { timeMs: 20 }), comment("b", { replyTo: "a" })],
      /before the comment it replies to/,
    ],
    ["itself", [comment("b", { replyTo: "b" })], /circle of replies/],
    [
      "a circle",
      [comment("a", { replyTo: "b" }), comment("b", { replyTo: "a" })],
      /circle of replies/,
    ],
  ])("refuses a reply to %s", (_name, comments, message) => {
    const definition = study({
      settings: threads(true),
      posts: [
        { ref: "1", body: "hello", actor: "ann", timeMs: 0 },
        { ref: "2", body: "other", actor: "ann", timeMs: 0 },
      ],
      comments,
    });
    expect(messages(definition).join("\n")).toMatch(message);
    expect(hasErrors(validateStudy(definition))).toBe(true);
  });

  it("warns that replies flatten where threads are off", () => {
    const definition = study({
      settings: threads(false),
      comments: [comment("a"), comment("b", { replyTo: "a" })],
    });
    expect(messages(definition).join("\n")).toMatch(/1 replies show as ordinary comments/);
  });

  it("warns when a reply is in a condition its comment isn't", () => {
    const definition = study({
      settings: settings({
        conditions: { assignment: { method: "uniform" }, arms: [{ key: "a" }, { key: "b" }] },
      }),
      comments: [comment("a", { conditions: ["a"] }), comment("b", { replyTo: "a" })],
    });
    expect(messages(definition).join("\n")).toMatch(/won't show in b/);
  });
});
