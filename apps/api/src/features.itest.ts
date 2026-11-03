import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder } from "@truman3/study-import";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

/** One condition with everything on, and one with some features off. */
async function study() {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-features-"));
  dirs.push(dir);
  const slug = `features-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Features
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: blocked, blockSize: 2 }
  arms:
    - key: full
    - key: limited
      platform:
        features: { likes: false, comments: false, flagging: false, posting: false, following: false, blocking: false, reporting: false, notifications: false }
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name\nann,Ann\n",
    "posts.csv": "id,body,actor,likes,time\np1,hello,ann,0,-1:00\n",
    "comments.csv": "id,body,actor,postID,likes,time\nc1,a comment,ann,p1,0,-0:30\n",
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, { launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  return { slug, imported };
}

async function join(slug: string) {
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId: randomUUID() }),
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

const call = (cookie: string, method: string, url: string, body?: object) =>
  app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const meta = () => ({ clientEventId: randomUUID(), occurredAt: new Date().toISOString() });

/** Enrolls people until there's one in each condition, since assignment is blocked. */
async function oneInEach(slug: string) {
  const people: Record<string, string> = {};
  for (let i = 0; i < 4 && Object.keys(people).length < 2; i += 1) {
    const cookie = await join(slug);
    const flow = (await (await call(cookie, "GET", "/me/flow")).json()) as {
      features: { likes: boolean };
    };
    people[flow.features.likes ? "full" : "limited"] = cookie;
  }
  return people as { full: string; limited: string };
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

describe("features by condition", () => {
  it("tells the browser which platform someone has", async () => {
    const { slug } = await study();
    const { full, limited } = await oneInEach(slug);
    const flowOf = async (cookie: string) =>
      (await (await call(cookie, "GET", "/me/flow")).json()) as {
        layout: string;
        features: Record<string, boolean>;
      };
    expect(await flowOf(full)).toMatchObject({
      layout: "classic",
      features: { likes: true, comments: true },
    });
    expect(await flowOf(limited)).toMatchObject({
      layout: "classic",
      features: { likes: false, comments: false },
    });
  });

  it("refuses what's off in someone's condition, even with no button to press", async () => {
    const { slug } = await study();
    const { full, limited } = await oneInEach(slug);
    type Feed = { posts: { id: string; comments: unknown[] }[] };
    const postId = ((await (await call(full, "GET", "/feed")).json()) as Feed).posts[0]?.id;

    const attempts = [
      ["POST", `/content/${postId}/like`, { active: true, ...meta() }],
      ["POST", `/content/${postId}/flag`, { active: true, ...meta() }],
      ["POST", `/content/${postId}/comments`, { body: "hi", ...meta() }],
      ["POST", "/actors/ann/relation", { action: "follow", ...meta() }],
      ["POST", "/actors/ann/relation", { action: "block", ...meta() }],
      ["POST", "/actors/ann/relation", { action: "report", reason: "spam", ...meta() }],
      ["GET", "/notifications", undefined],
    ] as const;
    for (const [method, url, body] of attempts) {
      const refused = await call(limited, method, url, body);
      expect(refused.status, url).toBe(403);
    }
    const form = new FormData();
    form.set("body", "a post");
    form.set("clientEventId", randomUUID());
    form.set("occurredAt", new Date().toISOString());
    const refusedPost = await app.request("/posts", {
      method: "POST",
      headers: { cookie: limited },
      body: form,
    });
    expect(refusedPost.status).toBe(403);

    for (const [method, url, body] of attempts) {
      const allowed = await call(
        full,
        method,
        url,
        body && { ...body, clientEventId: randomUUID() },
      );
      expect(allowed.status, url).toBe(200);
    }
  });

  it("keeps comments out of the feed when they're off", async () => {
    const { slug } = await study();
    const { full, limited } = await oneInEach(slug);
    type Feed = { posts: { comments: unknown[] }[] };
    const commentsOf = async (cookie: string) =>
      ((await (await call(cookie, "GET", "/feed")).json()) as Feed).posts[0]?.comments.length;
    expect(await commentsOf(full)).toBe(1);
    expect(await commentsOf(limited)).toBe(0);
  });
});

describe("the record of what the platform was", () => {
  it("freezes the template's features, and puts them in the codebook", async () => {
    const { slug } = await study();
    const folder = mkdtempSync(path.join(tmpdir(), "truman-features-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    const codebook = readFileSync(path.join(folder, "codebook.md"), "utf8");
    expect(codebook).toContain("the Classic template");
    expect(codebook).toContain("| Likes | 1 | on | off |");
    expect(codebook).toContain("| Comments | 1 | on | off |");
    expect(codebook).toContain('"template": "classic"');
    expect(codebook).toContain('"layout": "classic"');
  });
});
