import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import type { FeedPost, FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

const HOUR = 3_600_000;

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

async function teamWithStudy() {
  const id = randomUUID().slice(0, 8);
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `Lab ${id}`,
    slug: `lab-${id}`,
    email: `${id}@example.edu`,
    name: "Owner",
  });

  const dir = mkdtempSync(path.join(tmpdir(), "truman-preview-"));
  dirs.push(dir);
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: preview-${id}
title: Preview test
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: blocked, blockSize: 2 }
  arms: [{ key: a }, { key: b }]
feed: { ranker: chronological, windowHours: 24 }
platform: { style: photo }
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }]
`,
    "actors.csv": "username,name\nann,Ann\n",
    "posts.csv": [
      "id,body,actor,likes,time,condition",
      "too-old,too old,ann,1,-30:00,",
      "start,at the start,ann,4,-1:00,",
      "for-a,only a,ann,0,-0:30,a",
      "for-b,only b,ann,0,-0:30,b",
      "later,six hours in,ann,0,6:00,",
      "after,after the end,ann,0,50:00,",
    ].join("\n"),
    "comments.csv": [
      "id,body,actor,postID,time,condition",
      "c1,comment for a,ann,start,-0:50,a",
      "c2,later comment,ann,start,3:00,",
    ].join("\n"),
  };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  const result = await importStudyFolder(database.db, storage, dir, { teamId, launch: true });
  if (result.status === "failed") {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }

  const login = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${id}@example.edu`, password }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

  return { cookie, versionId: result.studyVersionId, slug: `preview-${id}` };
}

type Lab = Awaited<ReturnType<typeof teamWithStudy>>;

async function preview(lab: Lab, condition: string, elapsedMs = 0) {
  const response = await app.request(
    `/admin/versions/${lab.versionId}/preview?condition=${condition}&elapsedMs=${elapsedMs}`,
    { headers: { cookie: lab.cookie } },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as FeedResponse & { targeting: Record<string, string[]> };
}

const bodies = (posts: FeedPost[]) => posts.map((post) => post.body);

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
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("previewing a feed", () => {
  it("shows what a participant in that condition would see at the start", async () => {
    const lab = await teamWithStudy();

    expect(bodies((await preview(lab, "a")).posts)).toEqual(["only a", "at the start"]);
    expect(bodies((await preview(lab, "b")).posts)).toEqual(["only b", "at the start"]);
  });

  it("moves through time, showing new posts and comments, and dropping old ones", async () => {
    const lab = await teamWithStudy();

    const six = (await preview(lab, "a", 6 * HOUR)).posts;
    expect(bodies(six)).toEqual(["six hours in", "only a", "at the start"]);
    expect(six.at(-1)?.comments.map((comment) => comment.body)).toEqual([
      "comment for a",
      "later comment",
    ]);

    const late = (await preview(lab, "a", 30 * HOUR)).posts;
    expect(bodies(late)).toEqual(["six hours in"]);
  });

  it("labels what's limited to certain conditions, so differences can be seen", async () => {
    const lab = await teamWithStudy();

    const { posts, targeting } = await preview(lab, "a");
    const limited = posts.find((post) => post.body === "only a");
    const shared = posts.find((post) => post.body === "at the start");

    expect(targeting[limited?.id ?? ""]).toEqual(["a"]);
    expect(targeting[shared?.id ?? ""]).toBeUndefined();
    expect(targeting[shared?.comments[0]?.id ?? ""]).toEqual(["a"]);
  });

  it("gives the same posts as the real feed, for a real participant at the same point", async () => {
    const lab = await teamWithStudy();
    const entered = await app.request(`/studies/${lab.slug}/enter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId: `real-${randomUUID()}` }),
    });
    const cookie = (entered.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    const real = (await (
      await app.request("/feed", { headers: { cookie } })
    ).json()) as FeedResponse;
    // Blocked assignment gives this first participant one of the two conditions.
    const condition = bodies(real.posts).includes("only a") ? "a" : "b";
    const previewed = await preview(lab, condition);

    const strip = (posts: FeedPost[]) =>
      posts.map(({ at: _at, comments, ...post }) => ({
        ...post,
        comments: comments.map(({ at: _commentAt, ...comment }) => comment),
      }));
    expect(strip(previewed.posts)).toEqual(strip(real.posts));
  });

  it("records nothing, since looking isn't participating", async () => {
    const lab = await teamWithStudy();
    const count = async () => ({
      impressions: (await database.db.select().from(schema.feedImpressions)).length,
      events: (await database.db.select().from(schema.events)).length,
      worlds: (await database.db.select().from(schema.worlds)).length,
      participants: (await database.db.select().from(schema.participants)).length,
    });
    const before = await count();

    await preview(lab, "a", HOUR);

    expect(await count()).toEqual(before);
  });

  it("rejects a condition that isn't in the study", async () => {
    const lab = await teamWithStudy();

    const response = await app.request(
      `/admin/versions/${lab.versionId}/preview?condition=nope&elapsedMs=0`,
      { headers: { cookie: lab.cookie } },
    );
    expect(response.status).toBe(404);
  });
});

describe("the study's timeline", () => {
  it("gives every post's timing, its conditions, and each condition's settings", async () => {
    const lab = await teamWithStudy();

    const response = await app.request(`/admin/versions/${lab.versionId}/preview-info`, {
      headers: { cookie: lab.cookie },
    });
    const info = (await response.json()) as {
      lengthMs: number;
      conditions: { key: string; windowHours: number | null; platformStyle: string }[];
      posts: { offsetMs: number; conditions: string[] }[];
    };

    expect(info.lengthMs).toBe(48 * HOUR);
    expect(info.conditions).toMatchObject([
      { key: "a", windowHours: 24, platformStyle: "photo" },
      { key: "b", windowHours: 24, platformStyle: "photo" },
    ]);
    expect(info.posts).toHaveLength(6);
    expect(info.posts).toContainEqual({ offsetMs: 50 * HOUR, conditions: [] });
  });
});

describe("who can preview", () => {
  it("requires signing in", async () => {
    const lab = await teamWithStudy();
    const response = await app.request(`/admin/versions/${lab.versionId}/preview-info`);
    expect(response.status).toBe(401);
  });

  it("doesn't let another team see a study", async () => {
    const mine = await teamWithStudy();
    const other = await teamWithStudy();

    for (const url of [
      `/admin/versions/${mine.versionId}/preview-info`,
      `/admin/versions/${mine.versionId}/preview?condition=a&elapsedMs=0`,
    ]) {
      const response = await app.request(url, { headers: { cookie: other.cookie } });
      expect(response.status).toBe(404);
    }
  });

  it("doesn't let a participant's session in", async () => {
    const lab = await teamWithStudy();
    const entered = await app.request(`/studies/${lab.slug}/enter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId: `p-${randomUUID()}` }),
    });
    const cookie = (entered.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    const response = await app.request(`/admin/versions/${lab.versionId}/preview-info`, {
      headers: { cookie },
    });
    expect(response.status).toBe(401);
    expect(
      await database.db
        .select()
        .from(schema.researchers)
        .where(eq(schema.researchers.id, randomUUID())),
    ).toEqual([]);
  });
});
