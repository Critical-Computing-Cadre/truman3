import { type StudySettings, studySettingsSchema } from "@truman3/core";
import { describe, expect, it } from "vitest";
import {
  assembleFeed,
  type FeedCandidate,
  type FeedSettings,
  type FeedViewer,
  feedSettingsFor,
} from "./assemble.ts";
import { RANKERS, type RankablePost } from "./rankers.ts";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const NOW = 1_000 * HOUR;

function post(id: string, hoursAgo: number, overrides: Partial<FeedCandidate> = {}): FeedCandidate {
  return {
    id,
    kind: "post",
    parentId: null,
    authorActorId: "ann",
    timeMs: NOW - hoursAgo * HOUR,
    position: null,
    conditions: [],
    ...overrides,
  };
}

function comment(
  id: string,
  parentId: string,
  hoursAgo: number,
  overrides: Partial<FeedCandidate> = {},
): FeedCandidate {
  return post(id, hoursAgo, { kind: "comment", parentId, ...overrides });
}

const viewer = (overrides: Partial<FeedViewer> = {}): FeedViewer => ({
  actorId: "me",
  conditionKey: "a",
  flaggedContentIds: new Set(),
  viewedContentIds: new Set(),
  blockedActorIds: new Set(),
  ...overrides,
});

const settings = (overrides: Partial<FeedSettings> = {}): FeedSettings => ({
  ranker: "chronological",
  reshuffleEachVisit: false,
  removeFlagged: false,
  removeBlocked: false,
  ...overrides,
});

function ids(
  candidates: FeedCandidate[],
  feedSettings = settings(),
  feedViewer = viewer(),
  seed = 1,
) {
  return assembleFeed(candidates, feedViewer, feedSettings, { nowMs: NOW, seed }).posts.map(
    ({ id }) => id,
  );
}

describe("time", () => {
  it("doesn't show anything from the future", () => {
    expect(ids([post("past", 1), post("now", 0), post("future", -0.01)])).toEqual(["now", "past"]);
  });

  it("doesn't show comments from the future", () => {
    const feed = assembleFeed(
      [post("p", 2), comment("past", "p", 1), comment("future", "p", -1)],
      viewer(),
      settings(),
      { nowMs: NOW, seed: 1 },
    );
    expect(feed.posts[0]?.commentIds).toEqual(["past"]);
  });
});

describe("the feed window", () => {
  it("has no limit unless the study sets one", () => {
    expect(ids([post("old", 5000)])).toEqual(["old"]);
  });

  it("drops posts older than the window, keeping one exactly at the edge", () => {
    const candidates = [post("in", 23), post("edge", 24), post("out", 24.01)];
    expect(ids(candidates, settings({ windowHours: 24 }))).toEqual(["in", "edge"]);
  });

  it("applies to posts only, so a visible old post keeps its old comments", () => {
    const feed = assembleFeed(
      [post("p", 10), comment("old", "p", 9.5)],
      viewer(),
      settings({ windowHours: 1000 }),
      { nowMs: NOW, seed: 1 },
    );
    expect(feed.posts[0]?.commentIds).toEqual(["old"]);
  });
});

describe("conditions", () => {
  const targeted = [
    post("all", 1),
    post("mine", 2, { conditions: ["a"] }),
    post("theirs", 3, { conditions: ["b"] }),
    post("both", 4, { conditions: ["a", "b"] }),
  ];

  it("shows content for everyone and for this viewer's condition", () => {
    expect(ids(targeted)).toEqual(["all", "mine", "both"]);
    expect(ids(targeted, settings(), viewer({ conditionKey: "b" }))).toEqual([
      "all",
      "theirs",
      "both",
    ]);
  });

  it("applies to comments too", () => {
    const feed = assembleFeed(
      [
        post("p", 5),
        comment("all", "p", 4),
        comment("mine", "p", 3, { conditions: ["a"] }),
        comment("theirs", "p", 2, { conditions: ["b"] }),
      ],
      viewer(),
      settings(),
      { nowMs: NOW, seed: 1 },
    );
    expect(feed.posts[0]?.commentIds).toEqual(["all", "mine"]);
  });
});

describe("flagged content", () => {
  const flagged = viewer({ flaggedContentIds: new Set(["bad", "bad-comment"]) });

  it("stays visible unless the study removes it", () => {
    expect(ids([post("bad", 1)], settings(), flagged)).toEqual(["bad"]);
  });

  it("gets removed when the study says so, for posts and comments", () => {
    const feed = assembleFeed(
      [post("bad", 3), post("ok", 2), comment("bad-comment", "ok", 1), comment("fine", "ok", 1)],
      flagged,
      settings({ removeFlagged: true }),
      { nowMs: NOW, seed: 1 },
    );
    expect(feed.posts.map(({ id }) => id)).toEqual(["ok"]);
    expect(feed.posts[0]?.commentIds).toEqual(["fine"]);
  });
});

describe("blocked actors", () => {
  const blocking = viewer({ blockedActorIds: new Set(["troll"]) });
  const candidates = [
    post("theirs", 3, { authorActorId: "troll" }),
    post("ok", 2),
    comment("their-comment", "ok", 1, { authorActorId: "troll" }),
    comment("fine", "ok", 1),
  ];

  it("stay visible unless the study removes them", () => {
    expect(ids(candidates, settings(), blocking)).toEqual(["ok", "theirs"]);
  });

  it("disappear when the study says so, for posts and comments", () => {
    const feed = assembleFeed(candidates, blocking, settings({ removeBlocked: true }), {
      nowMs: NOW,
      seed: 1,
    });
    expect(feed.posts.map(({ id }) => id)).toEqual(["ok"]);
    expect(feed.posts[0]?.commentIds).toEqual(["fine"]);
  });
});

describe("pinning a participant's own new post", () => {
  const candidates = [
    post("newer", 0.05),
    post("mine", 0.1, { authorActorId: "me" }),
    post("my-old", 1, { authorActorId: "me" }),
  ];

  it("doesn't happen unless the study asks for it", () => {
    expect(ids(candidates)).toEqual(["newer", "mine", "my-old"]);
  });

  it("puts it on top for the set time, then lets it sort normally", () => {
    const feed = assembleFeed(candidates, viewer(), settings({ pinOwnPostsMinutes: 10 }), {
      nowMs: NOW,
      seed: 1,
    });
    expect(feed.posts.map(({ id, pinned }) => [id, pinned])).toEqual([
      ["mine", true],
      ["newer", false],
      ["my-old", false],
    ]);
  });

  it("includes a post exactly at the limit", () => {
    const edge = [
      post("x", 0),
      post("mine", 0, { authorActorId: "me", timeMs: NOW - 10 * MINUTE }),
    ];
    expect(ids(edge, settings({ pinOwnPostsMinutes: 10 }))).toEqual(["mine", "x"]);
  });

  it("doesn't pin other people's posts", () => {
    expect(ids([post("a", 0.2), post("b", 0.1)], settings({ pinOwnPostsMinutes: 10 }))).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("rankers", () => {
  const many = Array.from({ length: 30 }, (_, i) => post(`post-${i}`, i + 1));
  const original = many.map(({ id }) => id);

  it("chronological puts the newest first", () => {
    expect(ids(many)).toEqual(original);
  });

  describe("shuffle", () => {
    const shuffle = settings({ ranker: "shuffle" });

    it("keeps every post, in a different order", () => {
      const result = ids(many, shuffle);
      expect([...result].sort()).toEqual([...original].sort());
      expect(result).not.toEqual(original);
    });

    it("gives the same order for the same seed, and a different order for another", () => {
      expect(ids(many, shuffle, viewer(), 7)).toEqual(ids(many, shuffle, viewer(), 7));
      expect(ids(many, shuffle, viewer(), 7)).not.toEqual(ids(many, shuffle, viewer(), 8));
    });

    it("puts unseen posts before seen ones", () => {
      const seen = new Set(original.slice(0, 10));
      const result = ids(many, shuffle, viewer({ viewedContentIds: seen }));

      expect(result.slice(0, 20).every((id) => !seen.has(id))).toBe(true);
      expect(result.slice(20).every((id) => seen.has(id))).toBe(true);
    });

    it("doesn't rearrange existing posts when a new one appears", () => {
      const before = ids(many, shuffle);
      const after = ids([...many, post("new", 0)], shuffle).filter((id) => id !== "new");
      expect(after).toEqual(before);
    });
  });

  describe("scripted", () => {
    it("follows the study's order, with anything created during the study first", () => {
      const candidates = [
        post("third", 1, { position: 2 }),
        post("first", 3, { position: 0 }),
        post("second", 2, { position: 1 }),
        post("mine", 5, { authorActorId: "me" }),
      ];
      expect(ids(candidates, settings({ ranker: "scripted" }))).toEqual([
        "mine",
        "first",
        "second",
        "third",
      ]);
    });
  });

  it("reports which ranker produced the feed", () => {
    const feed = assembleFeed([], viewer(), settings({ ranker: "shuffle" }), {
      nowMs: NOW,
      seed: 1,
    });
    expect(feed).toMatchObject({ ranker: "shuffle", rankerVersion: "1", posts: [] });
  });
});

describe("feedSettingsFor", () => {
  const study: StudySettings = studySettingsSchema.parse({
    schemaVersion: 1,
    slug: "demo",
    title: "Demo",
    site: { name: "Demo" },
    length: { days: 1 },
    entry: { idParam: "PID", idLabel: "ID", source: "x" },
    conditions: {
      assignment: { method: "uniform" },
      arms: [{ key: "a" }, { key: "b", feed: { ranker: "shuffle", windowHours: 2 } }],
    },
    feed: { ranker: "chronological", windowHours: 24, removeFlagged: true },
    flow: [{ step: "feed" }],
  });

  it("uses the study's settings for a condition with no changes", () => {
    expect(feedSettingsFor(study, "a")).toMatchObject({ ranker: "chronological", windowHours: 24 });
  });

  it("applies a condition's changes and keeps the rest", () => {
    expect(feedSettingsFor(study, "b")).toMatchObject({
      ranker: "shuffle",
      windowHours: 2,
      removeFlagged: true,
    });
  });
});

describe("replies to replies", () => {
  const thread = [
    post("p", 10),
    comment("first", "p", 9),
    comment("second", "p", 8),
    comment("reply", "first", 7),
    comment("deeper", "reply", 6),
  ];
  const assemble = (
    candidates: readonly FeedCandidate[],
    threaded: boolean,
    who: FeedViewer = viewer(),
    feed: FeedSettings = settings(),
  ) => assembleFeed(candidates, who, feed, { nowMs: NOW, seed: 1, threaded }).posts[0];

  it("puts a reply right after what it replies to, with how far down it is", () => {
    const shown = assemble(thread, true);
    expect(shown?.commentIds).toEqual(["first", "reply", "deeper", "second"]);
    expect(shown?.commentDepths).toEqual({ first: 0, reply: 1, deeper: 2, second: 0 });
  });

  it("shows the same comments as one list in time order without threads", () => {
    const shown = assemble(thread, false);
    expect(shown?.commentIds).toEqual(["first", "second", "reply", "deeper"]);
    expect(Object.values(shown?.commentDepths ?? {})).toEqual([0, 0, 0, 0]);
  });

  it.each([true, false])(
    "hides replies along with a flagged comment (threaded: %s)",
    (threaded) => {
      const shown = assemble(
        thread,
        threaded,
        viewer({ flaggedContentIds: new Set(["first"]) }),
        settings({ removeFlagged: true }),
      );
      expect(shown?.commentIds).toEqual(["second"]);
    },
  );

  it("doesn't show a reply before the comment it replies to has appeared", () => {
    const shown = assemble(
      [post("p", 10), comment("later", "p", -1), comment("early", "later", 1)],
      true,
    );
    expect(shown?.commentIds).toEqual([]);
  });

  it("hides a reply in a condition its comment isn't in", () => {
    const shown = assemble(
      [
        post("p", 10),
        comment("other", "p", 9, { conditions: ["b"] }),
        comment("reply", "other", 8),
      ],
      true,
    );
    expect(shown?.commentIds).toEqual([]);
  });

  it("survives a circle of replies", () => {
    const shown = assemble(
      [post("p", 10), comment("x", "y", 9), comment("y", "x", 8), comment("fine", "p", 7)],
      true,
    );
    expect(shown?.commentIds).toEqual(["fine"]);
  });
});

describe("the new and top orders", () => {
  const post = (id: string, timeMs: number, score?: number): RankablePost => ({
    id,
    timeMs,
    position: null,
    ...(score === undefined ? {} : { score }),
  });
  const context = { seed: 1, viewedPostIds: new Set<string>() };

  it("puts the newest first with new", () => {
    const order = RANKERS.new.rank([post("old", 1), post("recent", 2)], context);
    expect(order.map(({ id }) => id)).toEqual(["recent", "old"]);
  });

  it("puts the highest score first with top, and records each score", () => {
    const order = RANKERS.top.rank([post("low", 3, 1), post("high", 1, 50)], context);
    expect(order).toEqual([
      { id: "high", score: 50 },
      { id: "low", score: 1 },
    ]);
  });

  it("gives ties to the newer post", () => {
    const order = RANKERS.top.rank([post("old", 1, 5), post("recent", 2, 5)], context);
    expect(order.map(({ id }) => id)).toEqual(["recent", "old"]);
  });
});

describe("the order of comments", () => {
  const thread = [
    post("p", 10),
    comment("old", "p", 9, { score: 1 }),
    comment("reply", "old", 3, { score: 100 }),
    comment("mid", "p", 5, { score: 8 }),
    comment("late", "p", 2, { score: 4 }),
  ];
  const order = (commentOrder?: "scripted" | "top" | "new") =>
    assembleFeed(
      thread,
      viewer(),
      {
        ...settings(),
        ...(commentOrder ? { commentOrder } : {}),
      },
      { nowMs: NOW, seed: 1, threaded: true },
    );

  it("goes by the time written unless the study sets one, and says which it used", () => {
    expect(order().posts[0]?.commentIds).toEqual(["old", "reply", "mid", "late"]);
    expect(order()).toMatchObject({ commentOrder: "scripted", commentOrderVersion: "1" });
  });

  it("puts the highest score first, and replies stay under what they reply to", () => {
    expect(order("top").posts[0]?.commentIds).toEqual(["mid", "late", "old", "reply"]);
    expect(order("top").posts[0]?.commentDepths).toMatchObject({ old: 0, reply: 1 });
  });

  it("puts the newest first, and replies stay under what they reply to", () => {
    expect(order("new").posts[0]?.commentIds).toEqual(["late", "mid", "old", "reply"]);
  });
});
