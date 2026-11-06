import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { listParticipantPhotos } from "@truman3/study-export";
import { importStudyFolder } from "@truman3/study-import";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** A Short posts study where Ann replies to and likes a participant's first post. */
async function study(platform = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-looks-"));
  dirs.push(dir);
  const slug = `looks-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Looks
site: { name: Demo }
length: { days: 3 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }]
platform: { style: text, template: shortPosts ${platform} }
feed: { ranker: chronological }
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name,banner\nann,Ann,clouds.png\nbob,Bob,\n",
    "posts.csv": "id,body,actor,time\np1,Hello,ann,-1:00\n",
    "reactions.csv":
      "on,nth,type,actor,after,body\npost,0,reply,ann,0:00,Nice one\npost,0,like,bob,0:00,\n",
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  mkdirSync(path.join(dir, "media", "actors"), { recursive: true });
  writeFileSync(path.join(dir, "media", "actors", "clouds.png"), PNG);
  const imported = await importStudyFolder(database.db, storage, dir, { launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  return slug;
}

const meta = () => ({ clientEventId: randomUUID(), occurredAt: new Date().toISOString() });
const call = (cookie: string, method: string, url: string, body?: object) =>
  app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
async function join(slug: string) {
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId: randomUUID() }),
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}
function writePost(cookie: string, body: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...meta(), body })) {
    form.set(key, value);
  }
  return app.request("/posts", { method: "POST", headers: { cookie }, body: form });
}
const notificationsOf = async (cookie: string) =>
  (
    (await (await call(cookie, "GET", "/notifications")).json()) as {
      notifications: { type: string }[];
    }
  ).notifications;
const unreadOf = async (cookie: string) =>
  ((await (await call(cookie, "GET", "/me")).json()) as { unreadNotifications: number })
    .unreadNotifications;

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

describe("muting a thread", () => {
  it("stops notifications about it, and their count, until it's unmuted", async () => {
    const cookie = await join(await study());
    const made = await writePost(cookie, "My first post");
    const { id } = (await made.json()) as { id: string };
    expect((await notificationsOf(cookie)).map(({ type }) => type).sort()).toEqual([
      "like",
      "reply",
    ]);
    expect(await unreadOf(cookie)).toBe(2);

    const mute = (active: boolean) =>
      call(cookie, "POST", `/content/${id}/mute-thread`, { ...meta(), active });
    expect((await mute(true)).status).toBe(200);
    expect(await notificationsOf(cookie)).toEqual([]);
    expect(await unreadOf(cookie)).toBe(0);
    const feed = (await (await call(cookie, "GET", "/feed")).json()) as {
      posts: { id: string; threadMuted?: boolean }[];
    };
    expect(feed.posts.find((post) => post.id === id)?.threadMuted).toBe(true);

    expect((await mute(false)).status).toBe(200);
    expect(await notificationsOf(cookie)).toHaveLength(2);

    const events = await database.db
      .select({ type: schema.events.type })
      .from(schema.events)
      .where(eq(schema.events.targetContentId, id));
    expect(events.map(({ type }) => type)).toEqual(
      expect.arrayContaining(["content.thread_muted", "content.thread_unmuted"]),
    );
  });

  it("is refused with the feature off", async () => {
    const cookie = await join(await study(", features: { threadMuting: false }"));
    const { id } = (await (await writePost(cookie, "Hi")).json()) as { id: string };
    const muted = await call(cookie, "POST", `/content/${id}/mute-thread`, {
      ...meta(),
      active: true,
    });
    expect(muted.status).toBe(403);
    const rows = await database.db
      .select()
      .from(schema.contentInteractions)
      .where(
        and(
          eq(schema.contentInteractions.contentId, id),
          eq(schema.contentInteractions.kind, "mute_thread"),
        ),
      );
    expect(rows).toEqual([]);
  });
});

describe("a banner on a profile", () => {
  it("is the study's picture for someone in the cast, and nothing for anyone else", async () => {
    const cookie = await join(await study());
    const ann = (await (await call(cookie, "GET", "/actors/ann")).json()) as {
      bannerUrl: string | null;
    };
    expect(ann.bannerUrl).toMatch(/clouds\.png$/);
    const bob = (await (await call(cookie, "GET", "/actors/bob")).json()) as {
      bannerUrl: string | null;
    };
    expect(bob.bannerUrl).toBeNull();
  });
});

describe("a profile's Replies tab", () => {
  const replies = async (cookie: string, username: string) =>
    (
      (await (await call(cookie, "GET", `/feed?surface=replies&username=${username}`)).json()) as {
        posts: { id: string; body: string; comments: { body: string }[] }[];
      }
    ).posts;

  it("lists the posts someone replied to, with only their replies", async () => {
    const cookie = await join(await study());
    const made = await writePost(cookie, "My first post");
    const { id } = (await made.json()) as { id: string };
    const p1 = (
      (await (await call(cookie, "GET", "/feed")).json()) as {
        posts: { id: string; body: string }[];
      }
    ).posts.find(({ body }) => body === "Hello");
    await call(cookie, "POST", `/content/${p1?.id}/comments`, { ...meta(), body: "Hi Ann" });
    await call(cookie, "POST", `/content/${id}/comments`, { ...meta(), body: "Thanks, Ann" });

    // Ann's reply is under the participant's post, with the participant's own reply left out.
    expect(await replies(cookie, "ann")).toEqual([
      expect.objectContaining({ id, comments: [expect.objectContaining({ body: "Nice one" })] }),
    ]);
    const me = ((await (await call(cookie, "GET", "/me")).json()) as { username: string }).username;
    const mine = await replies(cookie, me);
    expect(mine.map(({ body }) => body).sort()).toEqual(["Hello", "My first post"]);
    expect(mine.flatMap(({ comments }) => comments.map(({ body }) => body)).sort()).toEqual([
      "Hi Ann",
      "Thanks, Ann",
    ]);
    expect(await replies(cookie, "bob")).toEqual([]);
  });

  it("is off when comments are", async () => {
    const cookie = await join(await study(", features: { comments: false }"));
    const response = await call(cookie, "GET", "/feed?surface=replies&username=ann");
    expect(response.status).toBe(403);
  });
});

describe("a participant's banner", () => {
  it("is saved with their profile, shown on it, and listed with their photos", async () => {
    const slug = await study();
    const cookie = await join(slug);
    const form = new FormData();
    for (const [key, value] of Object.entries(meta())) {
      form.set(key, value);
    }
    form.set("banner", new File([PNG], "banner.png", { type: "image/png" }));
    const saved = await app.request("/me/profile", {
      method: "POST",
      headers: { cookie },
      body: form,
    });
    expect(saved.status).toBe(200);
    const me = (await (await call(cookie, "GET", "/me")).json()) as {
      username: string;
      bannerUrl: string | null;
    };
    expect(me.bannerUrl).toMatch(/\/uploads\//);
    const page = (await (await call(cookie, "GET", `/actors/${me.username}`)).json()) as {
      bannerUrl: string | null;
    };
    expect(page.bannerUrl).toBe(me.bannerUrl);

    const [found] = await database.db
      .select({ id: schema.studies.id })
      .from(schema.studies)
      .where(eq(schema.studies.slug, slug));
    const photos = await listParticipantPhotos(database.db, found?.id as string);
    expect(photos.map(({ kind }) => kind)).toEqual(["banner"]);
  });
});
