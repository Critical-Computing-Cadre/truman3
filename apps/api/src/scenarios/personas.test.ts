import type { FeedResponse } from "@truman3/core";
import { type Acted, standInWriter, type Writer } from "@truman3/writer";
import { describe, expect, it } from "vitest";
import { type Budget, BudgetSpent, describeFeed, personaBehavior } from "./personas.ts";

type FeedPost = FeedResponse["posts"][number];

const author = (username: string, isViewer = false) => ({
  username,
  name: username === "maya" ? "Maya" : username === "jake" ? "Jake" : "You",
  pictureUrl: null,
  isViewer,
});
const comment = (id: string, who: string, body: string, depth = 0) =>
  ({
    id,
    depth,
    author: author(who, who === "me"),
    body,
    at: "2026-11-10T00:00:00.000Z",
    likes: 0,
    liked: false,
    ups: 0,
    downs: 0,
    vote: null,
    flagged: false,
  }) as FeedPost["comments"][number];
const post = (id: string, who: string, body: string, comments: FeedPost["comments"] = []) =>
  ({
    id,
    author: author(who, who === "me"),
    body,
    attachments: [],
    likes: 2,
    liked: false,
    comments,
    commentCount: comments.length,
  }) as unknown as FeedPost;

const feed = [
  post("p1", "maya", "My first painting!", [
    comment("c1", "jake", "lol my little brother paints better than this"),
    comment("c2", "me", "It's lovely", 1),
  ]),
];

/** A writer that answers with what it's given, in turn. */
function scripted(...answers: Omit<Acted, "model" | "costUsd">[]): Writer {
  const writer = standInWriter();
  let turn = 0;
  return {
    ...writer,
    act: async () => ({
      ...(answers[turn++] ?? { action: "nothing", item: null, text: "", why: "" }),
      model: "stand-in",
      costUsd: 0.5,
    }),
  };
}

const persona = { id: "upstander", about: "Kind, and quick to defend people." };

describe("describeFeed", () => {
  it("numbers posts and comments, with replies under what they answer", () => {
    const { text, items } = describeFeed(feed);
    expect(text).toBe(
      [
        '[1] Maya (@maya) posted: "My first painting!" (2 likes)',
        '  [2] Jake (@jake) commented: "lol my little brother paints better than this"',
        `    [3] You replied: "It's lovely"`,
      ].join("\n"),
    );
    expect(items.map(({ id, kind, mine }) => [id, kind, mine])).toEqual([
      ["p1", "post", false],
      ["c1", "comment", false],
      ["c2", "comment", true],
    ]);
  });
});

describe("a persona", () => {
  it("turns the model's choice into an action, and writes the transcript", async () => {
    const budget: Budget = { limitUsd: 5, spentUsd: 0 };
    const behavior = personaBehavior({
      persona,
      condition: "silent",
      writer: scripted(
        { action: "comment", item: 2, text: "Not cool, Jake.", why: "He's being mean." },
        { action: "follow", item: 1, text: "", why: "I like her art." },
        { action: "like", item: 3, text: "", why: "That's mine." },
      ),
      model: "stand-in",
      budget,
    });
    expect(await behavior.next({ at: 180_000, posts: feed })).toEqual({
      do: "comment",
      on: "c1",
      text: "Not cool, Jake.",
    });
    expect(await behavior.next({ at: 240_000, posts: feed })).toEqual({
      do: "follow",
      username: "maya",
    });
    // Their own comment can't be liked by them, so nothing is done, and the transcript says why.
    expect(await behavior.next({ at: 300_000, posts: feed })).toBeNull();

    const [first, second, third] = behavior.transcript.entries;
    expect(first).toMatchObject({
      at: 180_000,
      saw: [
        { who: "Maya", text: "My first painting!" },
        { who: "Jake", text: "lol my little brother paints better than this" },
      ],
      did: 'Commented "Not cool, Jake." on: Jake (@jake) commented: "lol my little brother paints better than this"',
      why: "He's being mean.",
    });
    // What they've already seen isn't new.
    expect(second).toMatchObject({ saw: [], did: "Followed @maya" });
    expect(third?.did).toBeNull();
    expect(third?.why).toContain("couldn't be done");
    expect(behavior.transcript.costUsd).toBe(1.5);
    expect(budget.spentUsd).toBe(1.5);
  });

  it("stops when the run's budget is spent", async () => {
    const budget: Budget = { limitUsd: 0.5, spentUsd: 0 };
    const behavior = personaBehavior({
      persona,
      condition: "silent",
      writer: scripted(),
      model: "stand-in",
      budget,
    });
    expect(await behavior.next({ at: 0, posts: feed })).toBeNull();
    await expect(behavior.next({ at: 60_000, posts: feed })).rejects.toBeInstanceOf(BudgetSpent);
  });
});
