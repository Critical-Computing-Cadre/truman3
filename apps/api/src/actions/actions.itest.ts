import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const folders: string[] = [];
let counter = 0;

async function importStudy(
  feed = "{ ranker: chronological }",
  extra = "",
  arms = "[{ key: a }, { key: b }]",
) {
  counter += 1;
  const slug = `actions-${counter}`;
  const dir = mkdtempSync(path.join(tmpdir(), "truman-actions-"));
  folders.push(dir);
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Demo
site: { name: Demo }
length: { days: 10 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: blocked, blockSize: 2 }
  arms: ${arms}
feed: ${feed}
${extra}
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }]
`,
    "actors.csv": "username,name,bio,location\nann,Ann,Ann's bio,Bethlehem\nbob,Bob,,\n",
    "posts.csv": [
      "id,body,actor,likes,time,condition",
      "p1,first,ann,5,-1:00,",
      "for-a,only a,bob,0,-0:30,a",
      "for-b,only b,bob,0,-0:30,b",
      "later,not yet,ann,0,5:00,",
    ].join("\n"),
    "comments.csv": "id,body,actor,postID,likes,time\nc1,hello,bob,p1,2,-0:50\n",
    "reactions.csv": [
      "on,nth,type,actor,after,body,condition",
      "post,0,read,ann,0:00,,",
      "post,0,read,bob,0:00,,",
      "post,0,like,ann,0:00,,",
      "post,0,like,bob,1:00,,",
      "post,0,reply,ann,0:00,Nice post,",
      "post,0,reply,bob,1:00,Later reply,",
      "post,1,like,bob,0:00,,",
      "post,0,reply,bob,0:00,For a,a",
      "post,0,reply,bob,0:00,For b,b",
      "comment,0,like,ann,0:00,,",
    ].join("\n"),
  };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  const result = await importStudyFolder(database.db, storage, dir, { launch: true });
  if (result.status === "failed") {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  return slug;
}

async function enter(slug: string) {
  counter += 1;
  const externalId = `person-${counter}`;
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId }),
  });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const [row] = await database.db
    .select({
      participantId: schema.participants.id,
      worldId: schema.worldMemberships.worldId,
      actorId: schema.worldMemberships.actorId,
      key: schema.conditions.key,
    })
    .from(schema.participants)
    .innerJoin(
      schema.worldMemberships,
      eq(schema.worldMemberships.participantId, schema.participants.id),
    )
    .innerJoin(schema.assignments, eq(schema.assignments.participantId, schema.participants.id))
    .innerJoin(schema.conditions, eq(schema.conditions.id, schema.assignments.conditionId))
    .where(eq(schema.participants.externalId, externalId));
  return { cookie, externalId, ...row! };
}

type Person = Awaited<ReturnType<typeof enter>>;

const meta = () => ({ clientEventId: randomUUID(), occurredAt: new Date().toISOString() });

function send(person: Person, url: string, body: Record<string, unknown>) {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: person.cookie },
    body: JSON.stringify({ ...meta(), ...body }),
  });
}

function sendPost(person: Person, fields: Record<string, string | File>) {
  const form = new FormData();
  const all = { ...meta(), ...fields };
  for (const [key, value] of Object.entries(all)) {
    form.append(key, value);
  }
  return app.request("/posts", { method: "POST", headers: { cookie: person.cookie }, body: form });
}

async function feedOf(person: Person) {
  const response = await app.request("/feed", { headers: { cookie: person.cookie } });
  return ((await response.json()) as FeedResponse).posts;
}

const findPost = async (person: Person, body: string) => {
  const post = (await feedOf(person)).find((item) => item.body === body);
  if (!post) {
    throw new Error(`No post "${body}" in the feed.`);
  }
  return post;
};

const eventsOf = (person: Person) =>
  database.db.select().from(schema.events).where(eq(schema.events.worldId, person.worldId));

const eventTypes = async (person: Person) =>
  (await eventsOf(person)).map((event) => event.type).filter((type) => type !== "session.started");

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
  app = createApp({
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => undefined,
    secureCookies: true,
  });
});

afterAll(async () => {
  storage.close();
  await database.destroy();
  for (const dir of folders) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("liking", () => {
  it("records an action on scripted content, and updates what the feed shows", async () => {
    const person = await enter(await importStudy());
    const post = await findPost(person, "first");

    const response = await send(person, `/content/${post.id}/like`, { active: true });

    expect(response.status).toBe(200);
    expect(await findPost(person, "first")).toMatchObject({ liked: true, likes: 6 });
    const events = await eventsOf(person);
    expect(events.at(-1)).toMatchObject({
      type: "content.liked",
      source: "participant",
      targetContentId: post.id,
      actorId: person.actorId,
    });
  });

  it("can be undone, keeping both actions in the record", async () => {
    const person = await enter(await importStudy());
    const post = await findPost(person, "first");

    await send(person, `/content/${post.id}/like`, { active: true });
    await send(person, `/content/${post.id}/like`, { active: false });

    expect(await findPost(person, "first")).toMatchObject({ liked: false, likes: 5 });
    expect(await eventTypes(person)).toEqual(["content.liked", "content.unliked"]);
  });

  it("counts a retried request once", async () => {
    const person = await enter(await importStudy());
    const post = await findPost(person, "first");
    const same = meta();

    await send(person, `/content/${post.id}/like`, { active: true, ...same });
    await send(person, `/content/${post.id}/like`, { active: true, ...same });

    expect(await eventTypes(person)).toEqual(["content.liked"]);
    expect((await findPost(person, "first")).likes).toBe(6);
  });

  it("works on comments", async () => {
    const person = await enter(await importStudy());
    const comment = (await findPost(person, "first")).comments[0]!;

    await send(person, `/content/${comment.id}/like`, { active: true });

    expect((await findPost(person, "first")).comments[0]).toMatchObject({ liked: true, likes: 3 });
  });

  it("keeps the browser's time and the server's time separately", async () => {
    const person = await enter(await importStudy());
    const post = await findPost(person, "first");
    const occurredAt = "2020-01-02T03:04:05.000Z";

    await send(person, `/content/${post.id}/like`, { active: true, occurredAt });

    const event = (await eventsOf(person)).at(-1);
    expect(event?.occurredAt.toISOString()).toBe(occurredAt);
    expect(Date.now() - (event?.recordedAt.getTime() ?? 0)).toBeLessThan(60_000);
  });
});

describe("what a participant can act on", () => {
  it("can't touch content from another condition or not yet released", async () => {
    const slug = await importStudy();
    const first = await enter(slug);
    const second = await enter(slug);
    const theirs = await findPost(second, `only ${second.key}`);

    const hidden = await send(first, `/content/${theirs.id}/like`, { active: true });
    expect(hidden.status).toBe(404);
    expect(await eventTypes(first)).toEqual([]);

    const [later] = await database.db
      .select()
      .from(schema.content)
      .where(eq(schema.content.body, "not yet"));
    expect((await send(first, `/content/${later!.id}/like`, { active: true })).status).toBe(404);
  });

  it("can't see or touch what another participant wrote", async () => {
    const slug = await importStudy();
    const first = await enter(slug);
    const second = await enter(slug);
    const created = (await (await sendPost(first, { body: "private to my world" })).json()) as {
      id: string;
    };

    expect((await feedOf(second)).map((post) => post.body)).not.toContain("private to my world");
    expect((await send(second, `/content/${created.id}/like`, { active: true })).status).toBe(404);
    expect((await send(second, `/content/${created.id}/comments`, { body: "hi" })).status).toBe(
      404,
    );
  });

  it("requires signing in", async () => {
    const response = await app.request(`/content/${randomUUID()}/like`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...meta(), active: true }),
    });
    expect(response.status).toBe(401);
  });
});

describe("flagging", () => {
  it("shows as flagged by default, and can be undone", async () => {
    const person = await enter(await importStudy());
    const post = await findPost(person, "first");

    await send(person, `/content/${post.id}/flag`, { active: true });
    expect((await findPost(person, "first")).flagged).toBe(true);

    await send(person, `/content/${post.id}/flag`, { active: false });
    expect((await findPost(person, "first")).flagged).toBe(false);
    expect(await eventTypes(person)).toEqual(["content.flagged", "content.unflagged"]);
  });

  it("removes content when the study says so", async () => {
    const person = await enter(await importStudy("{ ranker: chronological, removeFlagged: true }"));
    const post = await findPost(person, "first");

    await send(person, `/content/${post.id}/flag`, { active: true });

    expect((await feedOf(person)).map((item) => item.body)).not.toContain("first");
  });
});

describe("commenting", () => {
  it("adds it to the post and records it", async () => {
    const person = await enter(await importStudy());
    const post = await findPost(person, "first");

    const response = await send(person, `/content/${post.id}/comments`, { body: " my comment " });

    expect(response.status).toBe(200);
    const comments = (await findPost(person, "first")).comments;
    expect(comments.at(-1)).toMatchObject({ body: "my comment", author: { isViewer: true } });
    expect(
      (await eventsOf(person)).find((event) => event.type === "content.created"),
    ).toMatchObject({ payload: { kind: "comment" }, targetContentId: comments.at(-1)?.id });
  });

  it("creates one comment when retried, and returns the same ID", async () => {
    const person = await enter(await importStudy());
    const post = await findPost(person, "first");
    const same = meta();
    const url = `/content/${post.id}/comments`;

    const first = await (await send(person, url, { body: "once", ...same })).json();
    const second = await (await send(person, url, { body: "once", ...same })).json();

    expect(second).toEqual(first);
    expect((await findPost(person, "first")).comments).toHaveLength(2);
  });

  it("can't be empty, and only goes on posts unless threads are on", async () => {
    const person = await enter(await importStudy());
    const post = await findPost(person, "first");

    expect((await send(person, `/content/${post.id}/comments`, { body: "  " })).status).toBe(400);
    expect(
      (await send(person, `/content/${post.comments[0]?.id}/comments`, { body: "hi" })).status,
    ).toBe(403);
  });
});

describe("posting", () => {
  it("creates a post with text and a photo, stored in file storage", async () => {
    const person = await enter(await importStudy());

    const response = await sendPost(person, {
      body: "my post",
      image: new File([JPEG], "photo.jpg", { type: "image/jpeg" }),
    });

    expect(response.status).toBe(200);
    const post = await findPost(person, "my post");
    expect(post.author.isViewer).toBe(true);
    expect(post.imageUrl).toContain(`/uploads/${person.worldId}/`);

    const key = post.imageUrl?.replace("http://media.test/", "") ?? "";
    const fetched = await fetch(`${process.env.MEDIA_PUBLIC_URL}/${key}`);
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(JPEG);
  });

  it("refuses an empty post, and files that aren't images whatever they claim to be", async () => {
    const person = await enter(await importStudy());

    expect((await sendPost(person, { body: " " })).status).toBe(400);
    const fake = new File(["<script>alert(1)</script>"], "x.jpg", { type: "image/jpeg" });
    expect((await sendPost(person, { body: "hi", image: fake })).status).toBe(400);
    expect(await eventTypes(person)).toEqual([]);
  });

  it("creates one post when retried", async () => {
    const person = await enter(await importStudy());
    const same = meta();

    await sendPost(person, { body: "once", ...same });
    await sendPost(person, { body: "once", ...same });

    expect((await feedOf(person)).filter((post) => post.body === "once")).toHaveLength(1);
  });
});

describe("the platform's style", () => {
  const JPEG_FILE = () => new File([JPEG], "photo.jpg", { type: "image/jpeg" });

  it("photo platforms need a photo, with an optional caption", async () => {
    const person = await enter(await importStudy(undefined, "platform: { style: photo }"));

    expect((await sendPost(person, { body: "just text" })).status).toBe(400);
    expect((await sendPost(person, { image: JPEG_FILE() })).status).toBe(200);
    expect((await sendPost(person, { body: "caption", image: JPEG_FILE() })).status).toBe(200);
  });

  it("text platforms don't take photos", async () => {
    const person = await enter(await importStudy(undefined, "platform: { style: text }"));

    expect((await sendPost(person, { body: "text", image: JPEG_FILE() })).status).toBe(400);
    expect((await sendPost(person, { body: "text" })).status).toBe(200);
  });

  it("takes either by default", async () => {
    const person = await enter(await importStudy());

    expect((await sendPost(person, { body: "text" })).status).toBe(200);
    expect((await sendPost(person, { image: JPEG_FILE() })).status).toBe(200);
  });

  it("can differ by condition", async () => {
    const slug = await importStudy(
      undefined,
      "",
      "[{ key: a, platform: { style: text } }, { key: b, platform: { style: photo } }]",
    );
    const first = await enter(slug);
    const second = await enter(slug);
    const textPerson = first.key === "a" ? first : second;
    const photoPerson = first.key === "a" ? second : first;

    expect((await sendPost(textPerson, { body: "x" })).status).toBe(200);
    expect((await sendPost(photoPerson, { body: "x" })).status).toBe(400);
  });
});

describe("scripted reactions", () => {
  async function postOnce() {
    const person = await enter(await importStudy());
    await sendPost(person, { body: "my post" });
    return person;
  }

  const notificationsOf = async (person: Person) => {
    const response = await app.request("/notifications", { headers: { cookie: person.cookie } });
    return (
      (await response.json()) as {
        notifications: {
          type: string;
          actors: { username: string }[];
          replyBody: string | null;
          targetBody: string;
          unread: boolean;
        }[];
      }
    ).notifications;
  };

  const passTime = (person: Person, hours: number) =>
    database.db
      .update(schema.notifications)
      .set({ dueAt: new Date(Date.now() - hours) })
      .where(eq(schema.notifications.worldId, person.worldId));

  it("add replies and likes as they come due, and not before", async () => {
    const person = await postOnce();

    const post = await findPost(person, "my post");
    expect(post.comments.map((comment) => comment.body)).toEqual([
      "Nice post",
      `For ${person.key}`,
    ]);
    expect(post.likes).toBe(1);
    expect(post.comments.map((comment) => comment.author.username)).toEqual(["ann", "bob"]);
  });

  it("only happen for the matching post, and the matching condition", async () => {
    const person = await postOnce();
    const other = person.key === "a" ? "b" : "a";

    const bodies = (await findPost(person, "my post")).comments.map((comment) => comment.body);
    expect(bodies).not.toContain(`For ${other}`);

    await sendPost(person, { body: "second post" });
    const second = await findPost(person, "second post");
    expect(second.comments).toEqual([]);
    expect(second.likes).toBe(1);
  });

  it("are recorded as coming from the script", async () => {
    const person = await postOnce();

    const scheduled = (await eventsOf(person)).filter(
      (event) => event.type === "reaction.scheduled",
    );
    expect(scheduled.length).toBeGreaterThan(0);
    expect(scheduled.every((event) => event.source === "script")).toBe(true);
    expect(scheduled.every((event) => event.participantId === person.participantId)).toBe(true);
  });

  it("trigger on comments too", async () => {
    const person = await enter(await importStudy());
    const post = await findPost(person, "first");

    await send(person, `/content/${post.id}/comments`, { body: "my comment" });

    const comment = (await findPost(person, "first")).comments.at(-1);
    expect(comment).toMatchObject({ body: "my comment", likes: 1 });
  });

  it("show up as notifications, grouping reads and likes on the same thing", async () => {
    const person = await postOnce();

    const notifications = await notificationsOf(person);
    const read = notifications.find((item) => item.type === "read");
    const replies = notifications.filter((item) => item.type === "reply");

    expect(read?.actors.map((actor) => actor.username).sort()).toEqual(["ann", "bob"]);
    expect(read?.targetBody).toBe("my post");
    expect(replies.map((item) => item.replyBody).sort()).toEqual(
      ["Nice post", `For ${person.key}`].sort(),
    );

    await passTime(person, 1000);
    expect(
      (await notificationsOf(person)).find((item) => item.type === "like")?.actors,
    ).toHaveLength(2);
  });

  it("say whether they're about a post or a comment", async () => {
    const person = await enter(await importStudy());
    await sendPost(person, { body: "my post" });
    const post = await findPost(person, "first");
    await send(person, `/content/${post.id}/comments`, { body: "my comment" });

    const response = await app.request("/notifications", { headers: { cookie: person.cookie } });
    const { notifications } = (await response.json()) as {
      notifications: { type: string; targetKind: string; targetBody: string }[];
    };

    expect(notifications.find((item) => item.targetBody === "my post")?.targetKind).toBe("post");
    expect(notifications.find((item) => item.targetBody === "my comment")?.targetKind).toBe(
      "comment",
    );
  });

  it("count as unread until they've been viewed", async () => {
    const person = await postOnce();
    const unread = async () => {
      const response = await app.request("/me", { headers: { cookie: person.cookie } });
      return ((await response.json()) as { unreadNotifications: number }).unreadNotifications;
    };

    expect(await unread()).toBeGreaterThan(0);
    expect((await notificationsOf(person)).every((item) => item.unread)).toBe(true);

    await send(person, "/notifications/viewed", {});

    expect(await unread()).toBe(0);
    expect((await notificationsOf(person)).some((item) => item.unread)).toBe(false);
    expect(await eventTypes(person)).toContain("notifications.viewed");
  });
});

describe("relationships with other actors", () => {
  const profile = async (person: Person, username: string) => {
    const response = await app.request(`/actors/${username}`, {
      headers: { cookie: person.cookie },
    });
    expect(response.status).toBe(200);
    return (await response.json()) as {
      following: boolean;
      blocked: boolean;
      reported: boolean;
      bio: string;
      location: string;
      posts: { body: string }[];
    };
  };

  it("shows a profile with only what this participant can see", async () => {
    const person = await enter(await importStudy());

    const ann = await profile(person, "ann");

    expect(ann).toMatchObject({ bio: "Ann's bio", location: "Bethlehem" });
    expect(ann.posts.map((post) => post.body)).toEqual(["first"]);
    expect((await profile(person, "bob")).posts.map((post) => post.body)).toEqual([
      `only ${person.key}`,
    ]);
  });

  it("follows and unfollows", async () => {
    const person = await enter(await importStudy());

    await send(person, "/actors/ann/relation", { action: "follow" });
    expect((await profile(person, "ann")).following).toBe(true);

    await send(person, "/actors/ann/relation", { action: "unfollow" });
    expect((await profile(person, "ann")).following).toBe(false);
    expect(await eventTypes(person)).toEqual(["actor.followed", "actor.unfollowed"]);
  });

  it("removes a blocked actor's content only when the study says so", async () => {
    const slug = await importStudy("{ ranker: chronological, removeBlocked: true }");
    const removes = await enter(slug);
    await send(removes, "/actors/ann/relation", { action: "block" });
    expect((await feedOf(removes)).map((post) => post.body)).not.toContain("first");
    expect((await profile(removes, "ann")).blocked).toBe(true);

    const keeps = await enter(await importStudy());
    await send(keeps, "/actors/ann/relation", { action: "block" });
    expect((await feedOf(keeps)).map((post) => post.body)).toContain("first");
  });

  it("records a report with its reason, and requires one", async () => {
    const person = await enter(await importStudy());

    expect((await send(person, "/actors/ann/relation", { action: "report" })).status).toBe(400);
    await send(person, "/actors/ann/relation", { action: "report", reason: "spam" });

    expect((await profile(person, "ann")).reported).toBe(true);
    expect((await eventsOf(person)).at(-1)).toMatchObject({
      type: "actor.reported",
      payload: { reason: "spam" },
    });
  });

  it("can't act on someone who doesn't exist, or themselves", async () => {
    const person = await enter(await importStudy());
    const [actor] = await database.db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.id, person.actorId));

    expect((await send(person, "/actors/nobody/relation", { action: "follow" })).status).toBe(404);
    expect(
      (await send(person, `/actors/${actor?.username}/relation`, { action: "follow" })).status,
    ).toBe(404);
  });
});

describe("the participant's profile", () => {
  const save = (person: Person, fields: Record<string, string | File>) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...meta(), ...fields })) {
      form.append(key, value);
    }
    return app.request("/me/profile", {
      method: "POST",
      headers: { cookie: person.cookie },
      body: form,
    });
  };

  const me = async (person: Person) => {
    const response = await app.request("/me", { headers: { cookie: person.cookie } });
    return (await response.json()) as {
      username: string;
      name: string;
      bio: string;
      pictureUrl: string | null;
    };
  };

  it("saves changes and records which fields changed, without their values", async () => {
    const person = await enter(await importStudy());

    const response = await save(person, {
      username: "newname",
      name: "My Name",
      bio: "Something personal",
      picture: new File([JPEG], "me.jpg"),
    });

    expect(response.status).toBe(200);
    const profile = await me(person);
    expect(profile).toMatchObject({ username: "newname", name: "My Name" });
    expect(profile.pictureUrl).toContain("/uploads/");

    const event = (await eventsOf(person)).at(-1);
    expect(event?.type).toBe("profile.updated");
    expect(event?.payload).toEqual({
      fields: expect.arrayContaining(["username", "name", "bio", "picture"]),
    });
    expect(JSON.stringify(event?.payload)).not.toContain("Something personal");
  });

  it("can't take the username of a scripted actor", async () => {
    const person = await enter(await importStudy());

    expect((await save(person, { username: "ann" })).status).toBe(409);
    expect((await save(person, { username: "bad name!" })).status).toBe(400);
  });

  it("shows on what they post", async () => {
    const person = await enter(await importStudy());
    await save(person, { name: "My Name" });
    await sendPost(person, { body: "my post" });

    expect((await findPost(person, "my post")).author.name).toBe("My Name");
  });
});
