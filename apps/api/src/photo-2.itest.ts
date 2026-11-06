import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import type { FeedResponse, StoryGroup } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { freezeDraft, loadDraft, openDraft } from "@truman3/drafts";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder } from "@truman3/study-import";
import { parse } from "csv-parse/sync";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

const STORIES = `id,actor,picture,caption,time,highlight,closeFriends
h1,ann,s1.jpg,Kept,-40:00,Trips,
h2,ann,s2.jpg,Also kept,-30:00,Trips,
h3,ann,s3.jpg,Food,-35:00,Food,
now,ann,s4.jpg,Up now,-1:00,,
close,bob,s5.jpg,Just for friends,-1:00,,yes
`;

async function study({
  stories = STORIES,
  reactions = "",
  platform = "",
}: {
  stories?: string;
  reactions?: string;
  platform?: string;
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-photo2-"));
  dirs.push(dir);
  const slug = `photo-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Photo
site: { name: Demo }
length: { days: 3 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }, { key: b }]
platform: { style: mixed, template: photo ${platform} }
feed: { ranker: chronological }
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name\nann,Ann\nbob,Bob\ncat,Cat\n",
    "posts.csv": [
      "id,body,picture,actor,likes,place,tagged,time",
      'p1,Hi,a.jpg,ann,108,"Ithaca, New York",bob|cat,-6:00',
      'p2,Two,b.jpg,bob,1,"Ithaca, New York",,-5:00',
      "p3,Three,c.jpg,cat,4,Lima,bob|{participant},-4:00",
      "p4,Words only,,cat,0,,,-3:00",
      "",
    ].join("\n"),
    "stories.csv": stories,
    ...(reactions ? { "reactions.csv": reactions } : {}),
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, { launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  return { slug, versionId: imported.studyVersionId };
}

const meta = () => ({ clientEventId: randomUUID(), occurredAt: new Date().toISOString() });
const call = (cookie: string, method: string, url: string, body?: object) =>
  app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
async function join(slug: string, externalId = randomUUID()) {
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId }),
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}
const storiesOf = async (cookie: string) =>
  ((await (await call(cookie, "GET", "/stories")).json()) as { stories: StoryGroup[] }).stories;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
function postStory(cookie: string, caption = "Mine", fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...meta(), caption, ...fields })) {
    form.set(key, value);
  }
  form.set("image", new File([PNG], "mine.png", { type: "image/png" }));
  return app.request("/stories", { method: "POST", headers: { cookie }, body: form });
}

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
  app = createApp({
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => undefined,
    secureCookies: false,
  });
});

afterAll(async () => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  storage.close();
  await database.destroy();
});

const feedOf = async (cookie: string, query: string) => {
  const response = await call(cookie, "GET", `/feed?${query}`);
  return { status: response.status, posts: ((await response.json()) as FeedResponse).posts };
};
function writePost(cookie: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...meta(), ...fields })) {
    form.set(key, value);
  }
  return app.request("/posts", { method: "POST", headers: { cookie }, body: form });
}
interface Profile {
  closeFriend: boolean;
  highlights: { title: string; stories: { caption?: string; seen: boolean }[] }[];
}
const profileOf = async (cookie: string, username: string) =>
  (await (await call(cookie, "GET", `/actors/${username}`)).json()) as Profile;

describe("places", () => {
  it("shows where a post was, and lists every post there", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const { posts } = await feedOf(cookie, "");
    expect(posts.find(({ body }) => body === "Hi")?.place).toBe("Ithaca, New York");
    expect(posts.find(({ body }) => body === "Words only")?.place).toBeUndefined();

    const there = await feedOf(
      cookie,
      `surface=place&place=${encodeURIComponent("Ithaca, New York")}`,
    );
    expect(there.posts.map(({ body }) => body)).toEqual(["Two", "Hi"]);
  });

  it("lets a participant add one to their post", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const made = await writePost(cookie, { body: "At the lake", place: "  Lima  " });
    expect(made.status).toBe(200);
    const there = await feedOf(cookie, "surface=place&place=Lima");
    expect(there.posts.map(({ body }) => body)).toEqual(["At the lake", "Three"]);
    expect(there.posts[0]?.place).toBe("Lima");
  });

  it("is refused, and left out, with the feature off", async () => {
    const { slug } = await study({ platform: ", features: { places: false }" });
    const cookie = await join(slug);
    const { posts } = await feedOf(cookie, "");
    expect(posts.some(({ place }) => place)).toBe(false);
    expect((await feedOf(cookie, "surface=place&place=Lima")).status).toBe(403);
    expect((await writePost(cookie, { body: "Hi", place: "Lima" })).status).toBe(403);
  });
});

describe("tagging people", () => {
  it("names who's tagged, and lists the posts someone is tagged in", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const { posts } = await feedOf(cookie, "");
    expect(posts.find(({ body }) => body === "Hi")?.tagged).toEqual([
      { username: "bob", name: "Bob" },
      { username: "cat", name: "Cat" },
    ]);
    const bob = await feedOf(cookie, "surface=tagged&username=bob");
    expect(bob.posts.map(({ body }) => body)).toEqual(["Three", "Hi"]);
    expect((await feedOf(cookie, "surface=tagged&username=nobody")).status).toBe(404);
  });

  it("is refused, and left out, with the feature off", async () => {
    const { slug } = await study({ platform: ", features: { photoTags: false }" });
    const cookie = await join(slug);
    const { posts } = await feedOf(cookie, "");
    expect(posts.some(({ tagged }) => tagged)).toBe(false);
    expect((await feedOf(cookie, "surface=tagged&username=bob")).status).toBe(403);
  });
});

describe("tagging the participant, and participants tagging people", () => {
  it("names them among who's tagged, tells them, and lists it on their own Tagged tab", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const { posts } = await feedOf(cookie, "");
    const three = posts.find(({ body }) => body === "Three");
    expect(three?.tagged?.map(({ name, isViewer }) => [name, isViewer ?? false])).toEqual([
      ["Bob", false],
      [expect.stringMatching(/^user-/), true],
    ]);

    const { notifications } = (await (await call(cookie, "GET", "/notifications")).json()) as {
      notifications: { type: string; actors: { username: string }[]; postId: string }[];
    };
    expect(notifications).toEqual([
      expect.objectContaining({
        type: "tag",
        actors: [expect.objectContaining({ username: "cat" })],
      }),
    ]);
    expect(notifications[0]?.postId).toBe(three?.id);

    const me = (await (await call(cookie, "GET", "/me")).json()) as { username: string };
    const mine = await feedOf(cookie, `surface=tagged&username=${me.username}`);
    expect(mine.posts.map(({ body }) => body)).toEqual(["Three"]);
  });

  it("doesn't tell them with tagging off", async () => {
    const { slug } = await study({ platform: ", features: { photoTags: false }" });
    const cookie = await join(slug);
    const { notifications } = (await (await call(cookie, "GET", "/notifications")).json()) as {
      notifications: unknown[];
    };
    expect(notifications).toEqual([]);
  });

  it("lets a participant tag people in the cast, and no one else", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const people = (await (await call(cookie, "GET", "/people")).json()) as {
      people: { username: string }[];
    };
    expect(people.people.map(({ username }) => username)).toEqual(["ann", "bob", "cat"]);

    const form = (tagged: string[]) => {
      const body = new FormData();
      for (const [key, value] of Object.entries({ ...meta(), body: "With friends" })) {
        body.set(key, value);
      }
      for (const name of tagged) {
        body.append("tagged", name);
      }
      return app.request("/posts", { method: "POST", headers: { cookie }, body });
    };
    const me = (await (await call(cookie, "GET", "/me")).json()) as { username: string };
    expect((await form(["ann", "nobody"])).status).toBe(400);
    expect((await form([me.username])).status).toBe(400);
    const made = await form(["ann", "bob", "ann"]);
    expect(made.status).toBe(200);
    const { id } = (await made.json()) as { id: string };

    const { posts } = await feedOf(cookie, "");
    expect(posts.find((post) => post.id === id)?.tagged?.map(({ username }) => username)).toEqual([
      "ann",
      "bob",
    ]);
    const [event] = await database.db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.type, "content.created"), eq(schema.events.targetContentId, id)));
    expect(event?.payload).toEqual({ kind: "post", tagged: ["ann", "bob"] });
  });

  it("refuses tagging, and the list of people, with the feature off", async () => {
    const { slug } = await study({ platform: ", features: { photoTags: false }" });
    const cookie = await join(slug);
    expect((await call(cookie, "GET", "/people")).status).toBe(403);
    expect((await writePost(cookie, { body: "Hi", tagged: "ann" })).status).toBe(403);
  });
});

describe("the Explore grid", () => {
  it("has photos from people they don't follow, and not their own", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    await writePost(cookie, { body: "Mine" });
    const before = await feedOf(cookie, "surface=explore");
    expect(before.posts.map(({ body }) => body)).toEqual(["Three", "Two", "Hi"]);

    await call(cookie, "POST", "/actors/bob/relation", { ...meta(), action: "follow" });
    const after = await feedOf(cookie, "surface=explore");
    expect(after.posts.map(({ body }) => body)).toEqual(["Three", "Hi"]);

    // What it showed is recorded, as for any list.
    const shown = await database.db
      .select()
      .from(schema.feedImpressions)
      .where(eq(schema.feedImpressions.surface, "explore"));
    expect(shown.length).toBeGreaterThan(0);
  });

  it("is refused with the feature off", async () => {
    const { slug } = await study({ platform: ", features: { exploreGrid: false }" });
    expect((await feedOf(await join(slug), "surface=explore")).status).toBe(403);
  });
});

describe("highlights", () => {
  it("keeps stories on a profile after they've left the row, by name", async () => {
    const { slug } = await study();
    const cookie = await join(slug);
    const row = await storiesOf(cookie);
    expect(row.flatMap(({ stories }) => stories.map(({ caption }) => caption))).not.toContain(
      "Kept",
    );
    const ann = await profileOf(cookie, "ann");
    expect(
      ann.highlights.map(({ title, stories }) => [title, stories.map(({ caption }) => caption)]),
    ).toEqual([
      ["Trips", ["Kept", "Also kept"]],
      ["Food", ["Food"]],
    ]);
    expect((await profileOf(cookie, "bob")).highlights).toEqual([]);
  });

  it("records a story seen from a highlight, which the row would refuse", async () => {
    const { slug, versionId } = await study();
    const cookie = await join(slug);
    const [trips] = (await profileOf(cookie, "ann")).highlights;
    const [kept] = await database.db
      .select({ id: schema.content.id })
      .from(schema.content)
      .where(and(eq(schema.content.studyVersionId, versionId), eq(schema.content.sourceRef, "h1")));
    const viewed = (from?: string) =>
      call(cookie, "POST", `/stories/${kept?.id}/viewed`, {
        ...meta(),
        dwellMs: 900,
        ended: "closed",
        ...(from ? { from } : {}),
      });
    expect(trips?.stories[0]?.seen).toBe(false);
    expect((await viewed()).status).toBe(404);
    expect((await viewed("highlight")).status).toBe(200);
    expect((await profileOf(cookie, "ann")).highlights[0]?.stories[0]?.seen).toBe(true);
    const [event] = await database.db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.type, "story.viewed"),
          eq(schema.events.targetContentId, kept?.id as string),
        ),
      );
    expect(event?.payload).toEqual({ dwellMs: 900, ended: "closed", from: "highlight" });
  });

  it("is empty, and refused, with the feature off", async () => {
    const { slug, versionId } = await study({ platform: ", features: { highlights: false }" });
    const cookie = await join(slug);
    expect((await profileOf(cookie, "ann")).highlights).toEqual([]);
    const [kept] = await database.db
      .select({ id: schema.content.id })
      .from(schema.content)
      .where(and(eq(schema.content.studyVersionId, versionId), eq(schema.content.sourceRef, "h1")));
    const viewed = await call(cookie, "POST", `/stories/${kept?.id}/viewed`, {
      ...meta(),
      dwellMs: 900,
      ended: "closed",
      from: "highlight",
    });
    expect(viewed.status).toBe(403);
  });
});

describe("close friends", () => {
  it("marks a story for close friends, with its own ring", async () => {
    const { slug } = await study();
    const groups = await storiesOf(await join(slug));
    const bob = groups.find(({ author }) => author.username === "bob");
    expect(bob?.closeFriends).toBe(true);
    expect(bob?.stories[0]?.closeFriends).toBe(true);
    expect(groups.find(({ author }) => author.username === "ann")?.closeFriends).toBe(false);
  });

  it("lets a participant keep a list, and post a story only its people see", async () => {
    const { slug } = await study({
      reactions: "on,nth,type,actor,after\nstory,0,read,ann,0:00\nstory,0,read,bob,0:00\n",
    });
    const cookie = await join(slug);
    const add = await call(cookie, "POST", "/actors/ann/relation", {
      ...meta(),
      action: "addCloseFriend",
    });
    expect(add.status).toBe(200);
    expect((await profileOf(cookie, "ann")).closeFriend).toBe(true);

    const made = await postStory(cookie, "For friends", { audience: "closeFriends" });
    expect(made.status).toBe(200);
    const { id } = (await made.json()) as { id: string };
    const [mine] = await storiesOf(cookie);
    expect(mine?.stories[0]?.closeFriends).toBe(true);
    const viewers = (await (await call(cookie, "GET", `/stories/${id}/viewers`)).json()) as {
      viewers: { username: string }[];
    };
    expect(viewers.viewers.map(({ username }) => username)).toEqual(["ann"]);

    await call(cookie, "POST", "/actors/ann/relation", { ...meta(), action: "removeCloseFriend" });
    expect((await profileOf(cookie, "ann")).closeFriend).toBe(false);
    const types = (
      await database.db
        .select({ type: schema.events.type, payload: schema.events.payload })
        .from(schema.events)
    ).filter(({ type }) => type.startsWith("actor.close_friend") || type === "content.created");
    expect(types.map(({ type }) => type)).toEqual(
      expect.arrayContaining(["actor.close_friend_added", "actor.close_friend_removed"]),
    );
    expect(types.map(({ payload }) => payload)).toContainEqual({
      kind: "story",
      audience: "closeFriends",
    });
  });

  it("is refused with the feature off, and its stories are ordinary", async () => {
    const { slug } = await study({ platform: ", features: { closeFriends: false }" });
    const cookie = await join(slug);
    const bob = (await storiesOf(cookie)).find(({ author }) => author.username === "bob");
    expect(bob?.closeFriends).toBe(false);
    expect(bob?.stories[0]?.closeFriends).toBeUndefined();
    expect((await postStory(cookie, "x", { audience: "closeFriends" })).status).toBe(403);
    const add = await call(cookie, "POST", "/actors/ann/relation", {
      ...meta(),
      action: "addCloseFriend",
    });
    expect(add.status).toBe(403);
  });
});

describe("saving and exporting", () => {
  it("is in the export, and stays through a draft unchanged", async () => {
    const { slug, versionId } = await study();
    const folder = mkdtempSync(path.join(tmpdir(), "truman-photo2-export-"));
    dirs.push(folder);
    await join(slug);
    await exportStudy(database.db, slug, folder);
    const content = parse(readFileSync(path.join(folder, "content.csv"), "utf8"), {
      columns: true,
    }) as Record<string, string>[];
    const p1 = content.find(({ source_ref }) => source_ref === "p1");
    expect(p1?.place).toBe("Ithaca, New York");
    expect(p1?.tagged).toBe("bob|cat");
    expect(content.find(({ source_ref }) => source_ref === "p3")?.tagged).toBe("bob|{participant}");
    expect(content.find(({ source_ref }) => source_ref === "h1")?.highlight).toBe("Trips");
    expect(content.find(({ source_ref }) => source_ref === "close")?.close_friends).toBe("true");
    expect(content.find(({ source_ref }) => source_ref === "now")?.close_friends).toBe("");

    const email = `${randomUUID()}@example.edu`;
    await setUpTeam(database.db, {
      teamName: "Lab",
      slug: `lab-${randomUUID().slice(0, 8)}`,
      email,
      name: "R",
    });
    const [researcher] = await database.db
      .select({ id: schema.researchers.id })
      .from(schema.researchers)
      .where(eq(schema.researchers.email, email));
    const opened = await openDraft(database.db, versionId, researcher?.id as string);
    const draft = await loadDraft(database.db, opened?.draftId as string);
    const frozen = await freezeDraft(database.db, draft as NonNullable<typeof draft>);
    // Places, tags, highlights, and close friends all came through, so nothing changed.
    expect(frozen.status).toBe("unchanged");
  });
});

describe('an "are you sure?" box\'s dark button', () => {
  it("is going back, unless the study chose posting anyway", async () => {
    const flowOf = async (slug: string) =>
      (await (await call(await join(slug), "GET", "/me/flow")).json()) as { sureButton: string };
    expect((await flowOf((await study()).slug)).sureButton).toBe("goBack");
    const chosen = await study({ platform: ", sureButton: postAnyway" });
    expect((await flowOf(chosen.slug)).sureButton).toBe("postAnyway");
  });
});
