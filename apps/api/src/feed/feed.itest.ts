import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

const HOUR = 3_600_000;

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const folders: string[] = [];
let counter = 0;

async function importStudy(feed = "{ ranker: chronological, windowHours: 24 }") {
  counter += 1;
  const slug = `feed-${counter}`;
  const dir = mkdtempSync(path.join(tmpdir(), "truman-feed-"));
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
  arms: [{ key: a }, { key: b }]
feed: ${feed}
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }]
`,
    "actors.csv": "username,name,picture\nann,Ann,ann.jpg\nbob,Bob,\n",
    "posts.csv": [
      "id,body,picture,actor,likes,time,condition",
      "old,too old,,ann,1,-30:00,",
      "shared,for everyone,photo.jpg,ann,4,-1:00,",
      "for-a,only a,,bob,2,-0:30,a",
      "for-b,only b,,bob,2,-0:20,b",
      "later,not yet,,ann,1,5:00,",
    ].join("\n"),
    "comments.csv": [
      "id,body,actor,postID,likes,time,condition",
      "c-now,visible comment,bob,shared,3,-0:50,",
      "c-a,comment for a,bob,shared,0,-0:40,a",
      "c-b,comment for b,bob,shared,0,-0:40,b",
      "c-later,future comment,bob,shared,0,3:00,",
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

/** Enrolls someone and returns what's needed to act as them and look them up. */
async function enter(slug: string, externalId: string) {
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

  return { cookie, ...row! };
}

async function feedOf(cookie: string) {
  const response = await app.request("/feed", { headers: { cookie } });
  expect(response.status).toBe(200);
  return ((await response.json()) as FeedResponse).posts;
}

const uniqueId = () => {
  counter += 1;
  return `person-${counter}`;
};

beforeAll(async () => {
  database = await createTestDatabase();
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

describe("GET /feed", () => {
  it("requires signing in", async () => {
    expect((await app.request("/feed")).status).toBe(401);
  });

  it("shows only what's visible right now for this participant's condition", async () => {
    const slug = await importStudy();
    const person = await enter(slug, uniqueId());
    const other = person.key === "a" ? "b" : "a";

    const posts = await feedOf(person.cookie);
    const bodies = posts.map((post) => post.body);

    expect(bodies).toEqual([`only ${person.key}`, "for everyone"]);
    expect(bodies).not.toContain(`only ${other}`);
    expect(bodies).not.toContain("too old");
    expect(bodies).not.toContain("not yet");

    const shared = posts.find((post) => post.body === "for everyone");
    expect(shared?.comments.map((comment) => comment.body)).toEqual([
      "visible comment",
      `comment for ${person.key}`,
    ]);
  });

  it("gives two participants in different conditions different content", async () => {
    const slug = await importStudy();
    const first = await enter(slug, uniqueId());
    const second = await enter(slug, uniqueId());

    expect(new Set([first.key, second.key])).toEqual(new Set(["a", "b"]));
    expect((await feedOf(first.cookie))[0]?.body).toBe(`only ${first.key}`);
    expect((await feedOf(second.cookie))[0]?.body).toBe(`only ${second.key}`);
  });

  it("shows authors, media, and like counts as the frontend needs them", async () => {
    const slug = await importStudy();
    const person = await enter(slug, uniqueId());

    const shared = (await feedOf(person.cookie)).find((post) => post.body === "for everyone");

    expect(shared).toMatchObject({
      attachments: [{ type: "image", url: "https://cdn.example.com/m/photo.jpg" }],
      likes: 4,
      liked: false,
      flagged: false,
      author: {
        username: "ann",
        name: "Ann",
        pictureUrl: "https://cdn.example.com/m/ann.jpg",
        isViewer: false,
      },
    });
    expect(shared?.comments[0]).toMatchObject({ likes: 3, author: { pictureUrl: null } });
  });

  it("never tells the browser about conditions or study internals", async () => {
    const slug = await importStudy();
    const person = await enter(slug, uniqueId());

    const response = await app.request("/feed", { headers: { cookie: person.cookie } });
    const text = await response.text();

    expect(text).not.toContain('"conditions"');
    expect(text).not.toContain('"class"');
    expect(text).not.toContain("sourceRef");
    expect(text).not.toContain(person.participantId);
  });

  it("releases content as time passes, measured from when they started", async () => {
    const slug = await importStudy();
    const person = await enter(slug, uniqueId());
    expect((await feedOf(person.cookie)).map((post) => post.body)).not.toContain("not yet");

    await database.db
      .update(schema.worlds)
      .set({ startedAt: new Date(Date.now() - 6 * HOUR) })
      .where(eq(schema.worlds.id, person.worldId));

    const posts = await feedOf(person.cookie);
    expect(posts[0]?.body).toBe("not yet");
    expect(posts.find((post) => post.body === "for everyone")?.comments.at(-1)?.body).toBe(
      "future comment",
    );
  });

  it("records what was shown, in order, with the ranker", async () => {
    const slug = await importStudy();
    const person = await enter(slug, uniqueId());

    const posts = await feedOf(person.cookie);

    const [impression] = await database.db
      .select()
      .from(schema.feedImpressions)
      .where(eq(schema.feedImpressions.worldId, person.worldId))
      .orderBy(desc(schema.feedImpressions.id))
      .limit(1);
    expect(impression).toMatchObject({
      viewerActorId: person.actorId,
      ranker: "chronological",
      rankerVersion: "1",
    });
    const items = impression?.items as {
      contentId: string;
      position: number;
      commentIds: string[];
    }[];
    expect(items.map((item) => item.contentId)).toEqual(posts.map((post) => post.id));
    expect(items.map((item) => item.position)).toEqual([0, 1]);
    expect(items[1]?.commentIds).toEqual(posts[1]?.comments.map((comment) => comment.id));
  });

  it("keeps a shuffled feed the same for one person across visits", async () => {
    const slug = await importStudy("{ ranker: shuffle }");
    const person = await enter(slug, uniqueId());

    const first = (await feedOf(person.cookie)).map((post) => post.id);
    const second = (await feedOf(person.cookie)).map((post) => post.id);

    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(1);
  });

  describe("reshuffling", () => {
    const visit = async (cookie: string, number: number) => {
      const response = await app.request(`/feed?visit=${number}`, { headers: { cookie } });
      return ((await response.json()) as FeedResponse).posts.map((post) => post.id);
    };

    it("keeps one order per person by default, whatever the visit", async () => {
      const slug = await importStudy("{ ranker: shuffle }");
      const person = await enter(slug, uniqueId());

      expect(await visit(person.cookie, 1)).toEqual(await visit(person.cookie, 2));
    });

    it("changes on each visit when the study asks, and stays reproducible", async () => {
      const slug = await importStudy("{ ranker: shuffle, reshuffleEachVisit: true }");
      const person = await enter(slug, uniqueId());

      const orders = new Set<string>();
      for (const number of [1, 2, 3, 4, 5, 6, 7, 8]) {
        orders.add((await visit(person.cookie, number)).join());
      }
      expect(orders.size).toBeGreaterThan(1);

      expect(await visit(person.cookie, 5)).toEqual(await visit(person.cookie, 5));

      const impressions = await database.db
        .select()
        .from(schema.feedImpressions)
        .where(eq(schema.feedImpressions.worldId, person.worldId));
      expect(new Set(impressions.map((row) => row.seed)).size).toBeGreaterThan(1);
      expect(impressions.every((row) => row.seed !== null)).toBe(true);
    });
  });

  it("uses the study's order for the scripted ranker", async () => {
    const slug = await importStudy("{ ranker: scripted }");
    const person = await enter(slug, uniqueId());

    expect((await feedOf(person.cookie)).map((post) => post.body)).toEqual([
      "too old",
      "for everyone",
      `only ${person.key}`,
    ]);
  });
});
