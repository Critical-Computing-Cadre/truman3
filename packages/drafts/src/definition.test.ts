import { type StudySettings, studySettingsSchema, validateStudy } from "@truman3/core";
import { describe, expect, it } from "vitest";
import { draftToDefinition } from "./definition.ts";
import type { DraftItem } from "./items.ts";

const ANN = "00000000-0000-4000-8000-000000000001";
const BOB = "00000000-0000-4000-8000-000000000002";
const POST = "00000000-0000-4000-8000-000000000003";

const settings: StudySettings = studySettingsSchema.parse({
  schemaVersion: 1,
  slug: "demo",
  title: "Demo",
  site: { name: "Demo", logo: "media/logo.png" },
  length: { days: 2 },
  entry: { idParam: "PID", idLabel: "ID", source: "x" },
  conditions: { assignment: { method: "uniform" }, arms: [{ key: "a" }] },
  flow: [{ step: "feed" }],
});

function item(id: string, kind: DraftItem["kind"], data: object, position = 0): DraftItem {
  return { id, kind, data, position, provenance: { origin: "researcher" } };
}

const ITEMS = [
  item(ANN, "actor", { username: "ann", name: "Ann", conditions: [], picture: "media/ann.jpg" }),
  item(BOB, "actor", { username: "bob", name: "Bob", conditions: [] }, 1),
  item(POST, "post", {
    ref: "p1",
    body: "hello",
    actorId: ANN,
    timeMs: 0,
    likes: 2,
    conditions: [],
    picture: "media/one.jpg",
  }),
  item(crypto.randomUUID(), "comment", {
    ref: "c1",
    body: "hi",
    actorId: BOB,
    postId: POST,
    timeMs: 60_000,
    likes: 0,
    conditions: ["a"],
  }),
  item(crypto.randomUUID(), "reaction", {
    on: "post",
    nth: 0,
    type: "like",
    actorId: BOB,
    afterMs: 1000,
    conditions: [],
  }),
];

describe("draftToDefinition", () => {
  it("turns item IDs into the usernames and refs a study definition uses", () => {
    const { definition } = draftToDefinition(settings, {}, ITEMS);

    expect(definition.posts[0]).toMatchObject({ ref: "p1", actor: "ann", likes: 2 });
    expect(definition.comments[0]).toMatchObject({ actor: "bob", post: "p1", conditions: ["a"] });
    expect(definition.reactions[0]).toMatchObject({ actor: "bob", type: "like" });
  });

  it("passes the same checks as a study written in files", () => {
    expect(validateStudy(draftToDefinition(settings, {}, ITEMS).definition)).toEqual([]);
  });

  it("gets caught by those checks when something's wrong", () => {
    const twoAnns = [
      ...ITEMS,
      item(crypto.randomUUID(), "actor", { username: "ann", name: "Other", conditions: [] }, 2),
    ];
    const messages = validateStudy(draftToDefinition(settings, {}, twoAnns).definition).map(
      (issue) => issue.message,
    );

    expect(messages).toContain(`The username "ann" is used by more than one actor.`);
  });

  it("treats stored images as themselves, so nothing gets uploaded again", () => {
    const { mediaKeys } = draftToDefinition(settings, {}, ITEMS);

    expect([...mediaKeys.values()].sort()).toEqual([
      "media/ann.jpg",
      "media/logo.png",
      "media/one.jpg",
    ]);
  });

  it("keeps each post and comment's provenance", () => {
    const { provenance } = draftToDefinition(settings, {}, ITEMS);

    expect(provenance.get("post:p1")).toEqual({ origin: "researcher" });
    expect(provenance.get("comment:c1")).toEqual({ origin: "researcher" });
  });

  it("keeps posts in their order", () => {
    const shuffled = [
      item(crypto.randomUUID(), "post", { ...(ITEMS[2]?.data as object), ref: "second" }, 5),
      item(crypto.randomUUID(), "post", { ...(ITEMS[2]?.data as object), ref: "first" }, 1),
      ...ITEMS.slice(0, 2),
    ];
    expect(draftToDefinition(settings, {}, shuffled).definition.posts.map((p) => p.ref)).toEqual([
      "first",
      "second",
    ]);
  });
});
