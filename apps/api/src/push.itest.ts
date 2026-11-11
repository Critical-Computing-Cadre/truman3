import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { type PushMessage, sendDuePushes } from "./push.ts";

/** Push notifications for participants in the app. ADR 66. */

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

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

const meta = () => ({ clientEventId: randomUUID(), occurredAt: new Date().toISOString() });

async function study(features: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-push-"));
  dirs.push(dir);
  const slug = `push-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Push
site: { name: Neighbors }
length: { days: 1 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }]
platform: { style: mixed, template: classic, features: { ${features} } }
feed: { ranker: chronological }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name\nann,Ann\nbob,Bob\n",
    "posts.csv": "id,body,actor,time\np1,Hello,ann,-1:00\n",
    "beats.yaml": `
beats:
  - { id: bob-writes, when: { time: "0:05" }, do: { action: message, actor: bob, text: "Hey there" } }
  - { id: ann-likes, when: { participant: post }, delay: "0:02", do: { action: like, actor: ann, on: trigger } }
`,
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
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const call = (method: string, url: string, body?: object) =>
    app.request(url, {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const post = async (text: string) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...meta(), body: text })) {
      form.set(key, value);
    }
    return app.request("/posts", { method: "POST", headers: { cookie }, body: form });
  };
  return Object.assign(call, { post });
}

const TOKEN = "ExponentPushToken[abc123]";

describe("push notifications", () => {
  it("are only for studies that turn them on", async () => {
    const call = await join(await study("messages: true"));
    const response = await call("POST", "/me/push", { token: TOKEN, platform: "ios" });
    expect(response.status).toBe(403);
  });

  it("send what newly comes due, saying who but not what, once each", async () => {
    const call = await join(await study("messages: true, push: true"));
    expect((await call("POST", "/me/push", { token: "not a token", platform: "ios" })).status).toBe(
      400,
    );
    expect((await call("POST", "/me/push", { token: TOKEN, platform: "ios" })).status).toBe(200);

    expect((await call.post("My first post")).status).toBe(200);

    const sent: PushMessage[] = [];
    const send = async (messages: PushMessage[]) => {
      sent.push(...messages);
    };
    // Ten minutes on, with the app closed: Bob's message and Ann's like have come due.
    const later = new Date(Date.now() + 10 * 60_000);
    expect(await sendDuePushes({ db: database.db, writer: null, send, now: later })).toBe(2);
    expect(
      sent
        .map(({ to, title, body, data }) => ({ to, title, body, data }))
        .sort((a, b) => a.body.localeCompare(b.body)),
    ).toEqual([
      {
        to: TOKEN,
        title: "Neighbors",
        body: "Ann liked your post",
        data: { path: "/notifications", kind: "notification" },
      },
      {
        to: TOKEN,
        title: "Neighbors",
        body: "Bob sent you a message",
        data: { path: "/messages/bob", kind: "message" },
      },
    ]);
    // Nothing anyone wrote is in a push.
    expect(JSON.stringify(sent)).not.toContain("Hey there");

    // Each is sent once.
    expect(await sendDuePushes({ db: database.db, writer: null, send, now: later })).toBe(0);
    const events = await database.db
      .select({ payload: schema.events.payload })
      .from(schema.events)
      .where(eq(schema.events.type, "push.sent"));
    expect(events).toHaveLength(2);
  });

  it("records the app being opened and closed, and push permission", async () => {
    const call = await join(await study("push: true"));
    const reported = await call("POST", "/events", {
      events: [
        { ...meta(), type: "app.opened", payload: { platform: "android" } },
        { ...meta(), type: "push.permission", payload: { granted: false } },
        { ...meta(), type: "app.closed", payload: { secondsOpen: 42 } },
      ],
    });
    expect(await reported.json()).toEqual({ recorded: 3 });
  });
});
