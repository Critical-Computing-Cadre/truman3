import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import { MAX_REPLY_DEPTH } from "@truman3/core";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

/** One condition with threads and one without, sharing the same comments. */
async function study(teamId?: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-threads-"));
  dirs.push(dir);
  const slug = `threads-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Threads
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: blocked, blockSize: 2 }
  arms:
    - key: threaded
      platform: { features: { threads: true } }
    - key: flat
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name\nann,Ann\nben,Ben\n",
    "posts.csv": "id,body,actor,likes,time\np1,hello,ann,0,-1:00\n",
    // The reply is listed first, so importing it depends on more than the file's order.
    "comments.csv":
      "id,body,actor,postID,replyToID,likes,time\nc2,the reply,ben,p1,c1,0,-0:20\nc1,the comment,ann,p1,,0,-0:30\nc3,later comment,ann,p1,,0,-0:10\n",
    "reactions.csv": "on,nth,type,actor,after,body\ncomment,0,reply,ben,0:00,scripted reply\n",
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, {
    launch: true,
    ...(teamId ? { teamId } : {}),
  });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  return { slug, versionId: imported.studyVersionId };
}

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

async function oneInEach(slug: string) {
  const people: Record<string, string> = {};
  for (let i = 0; i < 4 && Object.keys(people).length < 2; i += 1) {
    const cookie = await join(slug);
    const flow = (await (await call(cookie, "GET", "/me/flow")).json()) as {
      features: { threads: boolean };
    };
    people[flow.features.threads ? "threaded" : "flat"] = cookie;
  }
  return people as { threaded: string; flat: string };
}

type Feed = { posts: { id: string; comments: { id: string; body: string; depth: number }[] }[] };
const feedOf = async (cookie: string) =>
  ((await (await call(cookie, "GET", "/feed")).json()) as Feed).posts[0] as Feed["posts"][number];
const reply = (cookie: string, id: string, body: string) =>
  call(cookie, "POST", `/content/${id}/comments`, {
    body,
    clientEventId: randomUUID(),
    occurredAt: new Date().toISOString(),
  });

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

describe("replies to replies", () => {
  it("shows the same written comments as a thread or a flat list, by condition", async () => {
    const { threaded, flat } = await oneInEach((await study()).slug);
    expect((await feedOf(threaded)).comments.map(({ body, depth }) => [body, depth])).toEqual([
      ["the comment", 0],
      ["the reply", 1],
      ["later comment", 0],
    ]);
    expect((await feedOf(flat)).comments.map(({ body, depth }) => [body, depth])).toEqual([
      ["the comment", 0],
      ["the reply", 0],
      ["later comment", 0],
    ]);
  });

  it("lets a participant reply to a comment only where threads are on", async () => {
    const { threaded, flat } = await oneInEach((await study()).slug);
    const target = (await feedOf(threaded)).comments[1]?.id as string;

    expect((await reply(flat, target, "not here")).status).toBe(403);
    expect((await reply(threaded, target, "my reply")).status).toBe(200);

    const bodies = (await feedOf(threaded)).comments.map(({ body, depth }) => [body, depth]);
    expect(bodies.slice(1, 3)).toEqual([
      ["the reply", 1],
      ["my reply", 2],
    ]);
  });

  it("still lets people without threads comment on the post", async () => {
    const { flat } = await oneInEach((await study()).slug);
    const post = await feedOf(flat);
    expect((await reply(flat, post.id, "on the post")).status).toBe(200);
    expect((await feedOf(flat)).comments.map(({ body }) => body)).toContain("on the post");
  });

  it("puts a scripted reply under the participant's comment with threads, and on the post without", async () => {
    const { threaded, flat } = await oneInEach((await study()).slug);
    for (const cookie of [threaded, flat]) {
      const post = await feedOf(cookie);
      expect((await reply(cookie, post.id, "mine")).status).toBe(200);
    }
    const scripted = async (cookie: string) => {
      const { comments } = await feedOf(cookie);
      const at = comments.findIndex(({ body }) => body === "scripted reply");
      return { depth: comments[at]?.depth, before: comments[at - 1]?.body };
    };
    expect(await scripted(threaded)).toEqual({ depth: 1, before: "mine" });
    expect((await scripted(flat)).depth).toBe(0);
  });

  it("stops a thread from going deeper than the limit", async () => {
    const { threaded } = await oneInEach((await study()).slug);
    let target = (await feedOf(threaded)).comments[0]?.id as string;
    // That comment is at depth 0, so this many replies reach the deepest allowed.
    for (let i = 0; i < MAX_REPLY_DEPTH - 1; i += 1) {
      const response = await reply(threaded, target, `level ${i}`);
      expect(response.status).toBe(200);
      target = ((await response.json()) as { id: string }).id;
    }
    expect((await reply(threaded, target, "too deep")).status).toBe(404);
  });
});

describe("replies in a draft", () => {
  async function openDraft() {
    const id = randomUUID().slice(0, 8);
    const email = `${id}@example.edu`;
    const { teamId, password } = await setUpTeam(database.db, {
      teamName: `lab-${id}`,
      slug: `lab-${id}`,
      email,
      name: "Owner",
    });
    const { versionId } = await study(teamId);
    const login = await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const opened = await call(cookie, "POST", `/admin/versions/${versionId}/draft`);
    const { draftId } = (await opened.json()) as { draftId: string };
    const comments = async () => {
      const response = await call(
        cookie,
        "GET",
        `/admin/drafts/${draftId}/preview?condition=threaded&elapsedMs=0`,
      );
      return ((await response.json()) as Feed).posts[0]?.comments ?? [];
    };
    return { cookie, draftId, comments };
  }

  it("keeps a saved version's replies when it's opened for editing", async () => {
    const { comments } = await openDraft();
    expect((await comments()).map(({ body, depth }) => [body, depth])).toEqual([
      ["the comment", 0],
      ["the reply", 1],
      ["later comment", 0],
    ]);
  });

  it("removes a comment's replies along with it", async () => {
    const { cookie, draftId, comments } = await openDraft();
    const parent = (await comments())[0]?.id as string;
    const response = await call(cookie, "DELETE", `/admin/drafts/${draftId}/items/${parent}`);
    expect(await response.json()).toEqual({ deleted: 2 });
    expect((await comments()).map(({ body }) => body)).toEqual(["later comment"]);
  });
});
