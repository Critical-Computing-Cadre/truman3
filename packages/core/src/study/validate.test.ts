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

describe("votes", () => {
  it("warns about written votes and scripted votes where votes are off", () => {
    const definition = study({
      posts: [{ ref: "1", body: "hello", actor: "ann", timeMs: 0, ups: 4 }],
      reactions: [{ on: "post", nth: 0, type: "down", actor: "ann", afterMs: 0 }],
    });
    const all = messages(definition).join("\n");
    expect(all).toMatch(/1 written vote counts won't show/);
    expect(all).toMatch(/scripted votes won't happen/);
  });

  it("doesn't warn where votes are on", () => {
    const definition = study({
      settings: settings({ platform: { style: "mixed", features: { votes: true } } }),
      posts: [{ ref: "1", body: "hello", actor: "ann", timeMs: 0, ups: 4 }],
    });
    expect(messages(definition).join("\n")).not.toMatch(/Votes are off/);
  });
});

describe("spaces", () => {
  const twoArms = {
    conditions: { assignment: { method: "uniform" }, arms: [{ key: "a" }, { key: "b" }] },
  };
  const on = { platform: { style: "mixed", features: { spaces: true } } };

  it("refuses a post in a space that doesn't exist, and a repeated key", () => {
    const definition = study({
      settings: settings(on),
      spaces: [
        { key: "x", name: "X" },
        { key: "x", name: "X again" },
      ],
      posts: [{ ref: "1", body: "hi", actor: "ann", timeMs: 0, space: "nope" }],
    });
    const all = messages(definition).join(" ");
    expect(all).toMatch(/"x" is listed more than once/);
    expect(all).toMatch(/space "nope", which doesn't exist/);
    expect(hasErrors(validateStudy(definition))).toBe(true);
  });

  it("warns when conditions see different spaces, without stopping anything", () => {
    const definition = study({
      settings: settings({ ...on, ...twoArms }),
      spaces: [{ key: "x", name: "X", conditions: ["a"] }],
    });
    expect(messages(definition).join(" ")).toMatch(/conditions see different spaces/);
    expect(hasErrors(validateStudy(definition))).toBe(false);
  });

  it("says nothing when every condition sees the same spaces", () => {
    const definition = study({
      settings: settings({ ...on, ...twoArms }),
      spaces: [{ key: "x", name: "X" }],
    });
    expect(messages(definition).join(" ")).not.toMatch(/different spaces/);
  });

  it("warns that spaces written for a condition with them off show in one feed", () => {
    const definition = study({ settings: settings(), spaces: [{ key: "x", name: "X" }] });
    expect(messages(definition).join(" ")).toMatch(/Spaces are off in "a"/);
  });

  it("warns when a post can't show because its space doesn't", () => {
    const definition = study({
      settings: settings({ ...on, ...twoArms }),
      spaces: [{ key: "x", name: "X", conditions: ["a"] }],
      posts: [{ ref: "1", body: "hi", actor: "ann", timeMs: 0, space: "x" }],
    });
    expect(messages(definition).join(" ")).toMatch(/won't show in b, because its space/);
  });

  it("warns that top only follows written scores where votes are off", () => {
    const definition = study({
      settings: settings({ feed: { ranker: "top" } }),
    });
    expect(messages(definition).join(" ")).toMatch(/top order is used in "a", but votes are off/);
  });

  it("says nothing about spaces for a study without them", () => {
    expect(messages(study({ settings: settings() })).join(" ")).not.toMatch(/[Ss]paces/);
  });
});

describe("forum features", () => {
  const forum = { platform: { style: "mixed", template: "forum" } };

  it("warns about posts with no title when titles are on", () => {
    expect(messages(study({ settings: settings(forum) }))).toContainEqual(
      expect.stringContaining('Titles are on in "a", but 1 posts'),
    );
    const titled = [{ ref: "1", title: "Yes", body: "", actor: "ann", timeMs: 0 }];
    expect(messages(study({ settings: settings(forum), posts: titled })).join()).not.toContain(
      "Titles",
    );
  });

  it("warns about what's written for what's off", () => {
    const written = messages(
      study({
        actors: [{ username: "ann", name: "Ann", karma: 5 }],
        posts: [{ ref: "1", title: "Yes", body: "hi", actor: "ann", timeMs: 0 }],
      }),
    );
    expect(written).toContainEqual(expect.stringContaining('Titles are off in "a"'));
    expect(written).toContainEqual(expect.stringContaining('Karma is off in "a"'));
  });

  it("takes only a real color for a community", () => {
    const colored = (accent: string) =>
      study({ spaces: [{ key: "x", name: "X", accent }] }).spaces[0]?.accent;
    expect(colored("#1d4ed8")).toBe("#1d4ed8");
    expect(() => colored("red;background:url(x)")).toThrow();
  });
});

describe("polls, flair, and crossposts", () => {
  const spaces = [
    { key: "x", name: "X", postFlair: [{ text: "News" }], userFlair: [{ text: "Chef" }] },
    { key: "y", name: "Y" },
  ];
  const poll = (...texts: string[]) => ({
    options: texts.map((text) => ({ text })),
  });
  const post = (fields: object) => ({ ref: "1", body: "b", actor: "ann", timeMs: 0, ...fields });
  const original = post({ ref: "o", space: "x" });

  it("needs a poll to have 2 to 6 options", () => {
    const parsed = (...texts: string[]) =>
      studyDefinitionSchema.safeParse({
        settings: settings(),
        actors: [],
        posts: [post({ poll: poll(...texts) })],
      }).success;
    expect(parsed("a")).toBe(false);
    expect(parsed("a", "b")).toBe(true);
    expect(parsed("a", "b", "c", "d", "e", "f", "g")).toBe(false);
  });

  it("refuses the same option twice", () => {
    expect(messages(study({ posts: [post({ poll: poll("Yes", "yes") })] })).join()).toContain(
      "same option twice",
    );
  });

  it("lets a post with only a poll or a crosspost have no text", () => {
    const definition = study({
      spaces,
      posts: [
        post({ body: "", poll: poll("a", "b") }),
        original,
        post({ ref: "2", body: "", space: "y", crosspostOf: "o" }),
      ],
    });
    expect(hasErrors(validateStudy(definition))).toBe(false);
  });

  it("checks flair against the space's list", () => {
    const issues = (fields: object) => messages(study({ spaces, posts: [post(fields)] })).join();
    expect(issues({ space: "x", flair: "Made up" })).toContain("doesn't offer");
    expect(issues({ flair: "News" })).toContain("isn't in one");
    expect(
      hasErrors(validateStudy(study({ spaces, posts: [post({ space: "x", flair: "News" })] }))),
    ).toBe(false);
  });

  it("checks people's flair against the space's list", () => {
    const issues = (spaceFlair: object) =>
      messages(study({ spaces, actors: [{ username: "ann", name: "Ann", spaceFlair }] })).join();
    expect(issues({ nowhere: "Chef" })).toContain("doesn't exist");
    expect(issues({ x: "Made up" })).toContain("doesn't offer");
  });

  it("won't require flair a space doesn't offer, and warns about scripted posts without it", () => {
    expect(
      messages(study({ spaces: [{ key: "x", name: "X", requirePostFlair: true }] })).join(),
    ).toContain("nobody could post there");
    const required = [{ ...spaces[0], requirePostFlair: true }];
    const definition = study({ spaces: required, posts: [post({ space: "x" })] });
    expect(hasErrors(validateStudy(definition))).toBe(false);
    expect(messages(definition).join()).toContain("has no flair");
  });

  it("refuses the same flair twice", () => {
    const twice = [{ key: "x", name: "X", postFlair: [{ text: "A" }, { text: "A" }] }];
    expect(messages(study({ spaces: twice })).join()).toContain("same post flair twice");
  });

  it("checks what a crosspost points at", () => {
    const issues = (posts: object[]) => messages(study({ spaces, posts })).join();
    expect(issues([post({ space: "y", crosspostOf: "gone" })])).toContain("doesn't exist");
    expect(issues([post({ space: "y", crosspostOf: "1" })])).toContain("of itself");
    expect(issues([original, post({ crosspostOf: "o" })])).toContain("has to be in a space");
    expect(issues([original, post({ space: "x", crosspostOf: "o" })])).toContain("already in");
    expect(
      issues([
        original,
        post({ ref: "2", space: "y", crosspostOf: "o" }),
        post({ ref: "3", space: "x", crosspostOf: "2" }),
      ]),
    ).toContain("is a crosspost too");
  });

  it("warns about a crosspost that shows before, or where, its original doesn't", () => {
    const issues = (fields: object, of: object = {}) =>
      messages(
        study({
          settings: settings({
            conditions: {
              assignment: { method: "uniform" },
              arms: [{ key: "a" }, { key: "b", feed: { ranker: "shuffle" } }],
            },
          }),
          spaces,
          posts: [
            { ...original, ...of },
            post({ ref: "2", space: "y", crosspostOf: "o", ...fields }),
          ],
        }),
      ).join();
    expect(issues({ timeMs: -5 })).toContain("appears before");
    expect(issues({}, { conditions: ["a"] })).toContain("isn't available in b");
  });

  it("warns when a feature's content won't show", () => {
    const off = settings({
      platform: { style: "mixed", features: { polls: false, flair: false, crossposting: false } },
    });
    const text = messages(
      study({
        settings: off,
        spaces,
        posts: [
          original,
          post({ ref: "2", space: "x", flair: "News", poll: poll("a", "b") }),
          post({ ref: "3", space: "y", crosspostOf: "o" }),
        ],
      }),
    ).join();
    expect(text).toContain("Polls are off");
    expect(text).toContain("Flair labels are off");
    expect(text).toContain("Crossposts are off");
  });

  it("warns when crossposting is on without what it needs", () => {
    const on = settings({
      platform: {
        style: "mixed",
        features: { crossposting: true, posting: false },
      },
    });
    expect(messages(study({ settings: on })).join()).toContain("it needs writing posts and spaces");
  });
});

describe("removals", () => {
  const removal = { on: "post", target: "1", actor: "ann", timeMs: 1000 };

  it("needs something that exists to remove, and someone to do it", () => {
    const found = messages(
      study({
        removals: [
          { ...removal, target: "nope" },
          { ...removal, actor: "nobody" },
          { ...removal, on: "comment" },
        ],
      }),
    );
    expect(found.some((text) => text.includes('post "nope" points at a post that isn'))).toBe(true);
    expect(found.some((text) => text.includes("nobody"))).toBe(true);
    expect(found.some((text) => text.includes("points at a comment"))).toBe(true);
  });

  it("warns about one set before what it removes appears", () => {
    expect(messages(study({ removals: [{ ...removal, timeMs: -1 }] }))).toContainEqual(
      expect.stringContaining("already be removed"),
    );
  });

  it("warns when the feature is off, as it is in Classic", () => {
    expect(messages(study({ removals: [removal] }))).toContainEqual(
      expect.stringContaining('Moderators removing things is off in "a"'),
    );
    expect(
      messages(
        study({
          reactions: [
            { on: "post", nth: 0, type: "remove", actor: "ann", afterMs: 0, body: "Why" },
          ],
        }),
      ),
    ).toContainEqual(expect.stringContaining('Moderators removing things is off in "a"'));
  });

  it("lets a removal reaction have a reason, and nothing else new have text", () => {
    const reaction = { on: "post", nth: 0, actor: "ann", afterMs: 0, body: "Text" };
    const found = validateStudy(
      study({
        settings: settings({ platform: { style: "mixed", template: "forum" } }),
        reactions: [{ ...reaction, type: "remove" }],
      }),
    );
    expect(hasErrors(found)).toBe(false);
    expect(hasErrors(validateStudy(study({ reactions: [{ ...reaction, type: "like" }] })))).toBe(
      true,
    );
  });
});

describe("warnings and the mod log", () => {
  const warn = { on: "post", nth: 0, type: "warn", actor: "ann", afterMs: 0 };
  const forum = settings({ platform: { style: "mixed", template: "forum" } });

  it("needs a warning to say something", () => {
    expect(hasErrors(validateStudy(study({ settings: forum, reactions: [warn] })))).toBe(true);
    expect(
      hasErrors(validateStudy(study({ settings: forum, reactions: [{ ...warn, body: "Hey" }] }))),
    ).toBe(false);
  });

  it("warns when warnings are off, as they are in Classic", () => {
    expect(messages(study({ reactions: [{ ...warn, body: "Hey" }] }))).toContainEqual(
      expect.stringContaining('Moderators warning people is off in "a"'),
    );
  });

  it("warns about a mod log with no removals to list", () => {
    const features = { modLog: true, removal: false };
    expect(
      messages(
        study({
          settings: settings({ platform: { style: "mixed", template: "forum", features } }),
        }),
      ),
    ).toContainEqual(expect.stringContaining("A mod log is on"));
  });
});

describe("answers to flags", () => {
  const forum = settings({ platform: { style: "mixed", template: "forum" } });
  const any = { action: "answer", actor: "ann", afterMs: 0, message: "No rule was broken" };

  it("needs an answer to say something, and a target to exist and have a kind", () => {
    const errors = (answer: object) =>
      hasErrors(validateStudy(study({ settings: forum, flagAnswers: [answer] })));
    expect(errors(any)).toBe(false);
    expect(errors({ ...any, message: undefined })).toBe(true);
    expect(errors({ ...any, target: "nope", on: "post" })).toBe(true);
    expect(errors({ ...any, target: "1" })).toBe(true);
    expect(errors({ ...any, target: "1", on: "post" })).toBe(false);
    expect(errors({ action: "remove", actor: "ann", afterMs: 0 })).toBe(false);
  });

  it("warns when it can't happen", () => {
    expect(messages(study({ flagAnswers: [any] }))).toContainEqual(
      expect.stringContaining("Answering flags needs flagging"),
    );
    const noRemoval = settings({
      platform: { style: "mixed", template: "forum", features: { removal: false } },
    });
    expect(
      messages(
        study({
          settings: noRemoval,
          flagAnswers: [{ action: "remove", actor: "ann", afterMs: 0 }],
        }),
      ),
    ).toContainEqual(expect.stringContaining("flags won't lead to removals"));
  });
});

describe("bans and answers to reports", () => {
  const forum = settings({ platform: { style: "mixed", template: "forum" } });
  const actors = [
    { username: "ann", name: "Ann" },
    { username: "sam", name: "Sam" },
  ];
  const ban = { user: "ann", actor: "sam", timeMs: 1000 };

  it("needs people and a space that exist", () => {
    const errors = (item: object) =>
      hasErrors(validateStudy(study({ settings: forum, actors, bans: [item] })));
    expect(errors(ban)).toBe(false);
    expect(errors({ ...ban, user: "nobody" })).toBe(true);
    expect(errors({ ...ban, actor: "nobody" })).toBe(true);
    expect(errors({ ...ban, space: "nope" })).toBe(true);
  });

  it("warns about what's written after a ban, and when it can't happen", () => {
    const found = messages(
      study({
        settings: forum,
        actors,
        bans: [ban],
        posts: [{ ref: "1", body: "hello", actor: "ann", timeMs: 2000 }],
      }),
    );
    expect(found).toContainEqual(expect.stringContaining("come after their ban"));
    expect(messages(study({ actors, bans: [ban] }))).toContainEqual(
      expect.stringContaining('Moderators banning people is off in "a"'),
    );
  });

  it("needs an answer to a report to say something", () => {
    const answer = { action: "answer", actor: "sam", afterMs: 0 };
    const errors = (item: object) =>
      hasErrors(validateStudy(study({ settings: forum, actors, reportAnswers: [item] })));
    expect(errors(answer)).toBe(true);
    expect(errors({ ...answer, message: "No" })).toBe(false);
    expect(errors({ action: "ban", actor: "sam", afterMs: 0 })).toBe(false);
    expect(errors({ ...answer, message: "No", user: "nobody" })).toBe(true);
  });
});

describe("automatic rules and answers to appeals", () => {
  const forum = settings({ platform: { style: "mixed", template: "forum" } });
  const rule = {
    ref: "r",
    on: "post",
    match: "word",
    action: "remove",
    actor: "ann",
    afterMs: 0,
  };
  const errors = (fields: object) =>
    hasErrors(validateStudy(study({ settings: forum, ...fields })));

  it("needs words, someone, and something to say when it speaks", () => {
    expect(errors({ autoRules: [rule] })).toBe(false);
    expect(errors({ autoRules: [{ ...rule, match: " | * " }] })).toBe(true);
    expect(errors({ autoRules: [{ ...rule, actor: "nobody" }] })).toBe(true);
    expect(errors({ autoRules: [{ ...rule, action: "confirm" }] })).toBe(true);
    expect(errors({ autoRules: [{ ...rule, action: "confirm", message: "Sure?" }] })).toBe(false);
    expect(errors({ autoRules: [{ ...rule, holdOutcome: "remove" }] })).toBe(true);
    expect(errors({ autoRules: [rule, rule] })).toBe(true);
  });

  it("warns when it can't happen", () => {
    expect(messages(study({ autoRules: [rule] }))).toContainEqual(
      expect.stringContaining('Automatic rules are off in "a"'),
    );
    expect(
      messages(
        study({
          appealAnswers: [{ action: "uphold", actor: "ann", afterMs: 0, message: "No" }],
        }),
      ),
    ).toContainEqual(expect.stringContaining('Appeals are off in "a"'));
  });

  it("needs a removal that stands to say something", () => {
    const answer = { action: "uphold", actor: "ann", afterMs: 0 };
    expect(errors({ appealAnswers: [answer] })).toBe(true);
    expect(errors({ appealAnswers: [{ ...answer, action: "restore" }] })).toBe(false);
  });
});

describe("reposts, quotes, and what short posts add", () => {
  const short = settings({ platform: { style: "text", template: "shortPosts" } });
  const post = { ref: "1", body: "hello", actor: "ann", timeMs: 0 };
  const errors = (posts: object[], extra: object = {}) =>
    hasErrors(validateStudy(study({ settings: short, posts, ...extra })));

  it("needs what it points at to exist, and can't be both or a circle", () => {
    expect(errors([post, { ref: "2", body: "", actor: "ann", timeMs: 1, repostOf: "1" }])).toBe(
      false,
    );
    expect(errors([post, { ref: "2", body: "", actor: "ann", timeMs: 1, repostOf: "nope" }])).toBe(
      true,
    );
    expect(errors([post, { ref: "2", body: "x", actor: "ann", timeMs: 1, quoteOf: "nope" }])).toBe(
      true,
    );
    expect(
      errors([post, { ref: "2", body: "x", actor: "ann", timeMs: 1, repostOf: "1", quoteOf: "1" }]),
    ).toBe(true);
    expect(
      errors([
        { ref: "a", body: "", actor: "ann", timeMs: 0, repostOf: "b" },
        { ref: "b", body: "", actor: "ann", timeMs: 0, repostOf: "a" },
      ]),
    ).toBe(true);
  });

  it("warns about what won't show, or appears too early", () => {
    const early = messages(
      study({
        settings: short,
        posts: [
          { ...post, timeMs: 100 },
          { ref: "2", body: "words", actor: "ann", timeMs: 1, repostOf: "1" },
        ],
      }),
    );
    expect(early).toContainEqual(expect.stringContaining("appears before"));
    expect(early).toContainEqual(expect.stringContaining("is a repost, so what it says"));
    const classic = messages(
      study({ posts: [post, { ref: "2", body: "x", actor: "ann", timeMs: 1, quoteOf: "1" }] }),
    );
    expect(classic).toContainEqual(expect.stringContaining('Quote posts are off in "a"'));
  });

  it("warns about what's longer than participants can write", () => {
    const limited = settings({
      platform: { style: "text", template: "shortPosts", maxPostLength: 3 },
    });
    expect(messages(study({ settings: limited, posts: [post] }))).toContainEqual(
      expect.stringContaining("longer than what participants can write (3)"),
    );
  });
});
