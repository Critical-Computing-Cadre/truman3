import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAX_ATTACHMENTS } from "@truman3/core";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const photo = () => new File([JPEG], "photo.jpg", { type: "image/jpeg" });

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

async function study() {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-galleries-"));
  dirs.push(dir);
  const slug = `galleries-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Galleries
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: blocked, blockSize: 2 }
  arms:
    - key: several
      platform: { features: { galleries: true } }
    - key: single
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name\nann,Ann\n",
    "posts.csv": "id,body,picture,actor,time\np1,hello,one.jpg|two.jpg,ann,-1:00\n",
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, { launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  return slug;
}

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
    const flow = (await (await app.request("/me/flow", { headers: { cookie } })).json()) as {
      features: { galleries: boolean };
    };
    people[flow.features.galleries ? "several" : "single"] = cookie;
  }
  return people as { several: string; single: string };
}

const send = (cookie: string, images: File[], body = "mine") => {
  const form = new FormData();
  form.set("body", body);
  form.set("clientEventId", randomUUID());
  form.set("occurredAt", new Date().toISOString());
  for (const image of images) {
    form.append("image", image);
  }
  return app.request("/posts", { method: "POST", headers: { cookie }, body: form });
};

type Feed = { posts: { body: string; attachments: { type: string; url: string }[] }[] };
const postOf = async (cookie: string, body: string) =>
  ((await (await app.request("/feed", { headers: { cookie } })).json()) as Feed).posts.find(
    (post) => post.body === body,
  );

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

describe("several photos on a post", () => {
  it("imports them in order from one spreadsheet cell", async () => {
    const { several } = await oneInEach(await study());
    expect((await postOf(several, "hello"))?.attachments).toEqual([
      { type: "image", url: "https://cdn.example.com/m/one.jpg" },
      { type: "image", url: "https://cdn.example.com/m/two.jpg" },
    ]);
  });

  it("lets a participant add several, in the order they chose", async () => {
    const { several } = await oneInEach(await study());
    expect((await send(several, [photo(), photo(), photo()])).status).toBe(200);
    const post = await postOf(several, "mine");
    expect(post?.attachments).toHaveLength(3);
    expect(post?.attachments.every(({ type }) => type === "image")).toBe(true);
  });

  it("refuses several where the feature's off, and still allows one", async () => {
    const { single } = await oneInEach(await study());
    expect((await send(single, [photo(), photo()])).status).toBe(403);
    expect((await send(single, [photo()])).status).toBe(200);
    expect((await postOf(single, "mine"))?.attachments).toHaveLength(1);
  });

  it("refuses more than a post can have", async () => {
    const { several } = await oneInEach(await study());
    const tooMany = Array.from({ length: MAX_ATTACHMENTS + 1 }, photo);
    expect((await send(several, tooMany)).status).toBe(400);
  });

  it("refuses the whole post if one of its photos can't be used", async () => {
    const { several } = await oneInEach(await study());
    const fake = new File(["not an image"], "fake.jpg", { type: "image/jpeg" });
    expect((await send(several, [photo(), fake], "broken")).status).toBe(400);
    expect(await postOf(several, "broken")).toBeUndefined();
  });
});
