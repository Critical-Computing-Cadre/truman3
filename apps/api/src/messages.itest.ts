import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ConversationsResponse, FeedResponse, ThreadResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder } from "@truman3/study-import";
import { standInWriter, type WriteRequest } from "@truman3/writer";
import { parse } from "csv-parse/sync";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
/** A stand-in model, which says what it was asked to answer. */
const writer = standInWriter((request: WriteRequest) =>
  request.prompt.includes("Why were you mean") ? "relax, it was a joke" : "hey",
);
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
    writer,
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

/** A small study, with messages on unless it says otherwise, and the beats a test needs. */
async function study(beats = "", messages = true) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-messages-"));
  dirs.push(dir);
  const slug = `messages-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Messages
site: { name: Demo }
length: { days: 1 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }]
platform: { style: mixed, template: classic, features: { messages: ${messages} } }
feed: { ranker: chronological }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name\njake,Jake\nmaya,Maya\n",
    "posts.csv": "id,body,actor,time\np1,Hello from Maya,maya,-1:00\n",
  };
  if (beats) {
    files["beats.yaml"] = beats;
  }
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, { launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  return slug;
}

const send = (cookie: string, to: string, body: string) =>
  call(cookie, "POST", `/messages/${to}`, { ...meta(), body });
const conversations = async (cookie: string) =>
  ((await (await call(cookie, "GET", "/messages")).json()) as ConversationsResponse).conversations;
const thread = async (cookie: string, username: string) =>
  (await (await call(cookie, "GET", `/messages/${username}`)).json()) as ThreadResponse;
const unread = async (cookie: string) =>
  ((await (await call(cookie, "GET", "/me")).json()) as { unreadMessages: number }).unreadMessages;

/** Moves every waiting beat in the database this many minutes earlier, so it comes due. */
async function hurry(minutes: number) {
  await database.db
    .update(schema.beatRuns)
    .set({ dueAt: sql`${schema.beatRuns.dueAt} - interval '1 minute' * ${minutes}` })
    .where(eq(schema.beatRuns.status, "pending"));
}

describe("direct messages", () => {
  it("are off unless a study turns them on", async () => {
    const cookie = await join(await study("", false));
    expect((await call(cookie, "GET", "/messages")).status).toBe(403);
    expect((await send(cookie, "jake", "Hi")).status).toBe(403);
    expect(await unread(cookie)).toBe(0);
  });

  it("go to someone in the cast, stay off the feed, and can't be liked", async () => {
    const cookie = await join(await study());
    const sent = await send(cookie, "maya", "  Love your post!  ");
    expect(sent.status).toBe(200);
    const { id } = (await sent.json()) as { id: string };

    const [conversation] = await conversations(cookie);
    expect(conversation).toMatchObject({
      with: { username: "maya", name: "Maya" },
      last: { id, body: "Love your post!", mine: true },
      unread: 0,
    });
    expect((await thread(cookie, "maya")).messages.map(({ body }) => body)).toEqual([
      "Love your post!",
    ]);

    const posts = ((await (await call(cookie, "GET", "/feed")).json()) as FeedResponse).posts;
    expect(posts.map(({ body }) => body)).toEqual(["Hello from Maya"]);
    expect(
      (await call(cookie, "POST", `/content/${id}/like`, { ...meta(), active: true })).status,
    ).toBe(404);

    // Nobody outside the cast, and not themselves.
    const { username } = (await (await call(cookie, "GET", "/me")).json()) as {
      username: string;
    };
    expect((await send(cookie, username, "Me")).status).toBe(404);
    expect((await send(cookie, "nobody", "Hi")).status).toBe(404);

    const [event] = await database.db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.targetContentId, id), eq(schema.events.type, "content.created")));
    expect(event?.payload).toEqual({ kind: "message", to: "maya" });
  });

  it("set off a beat, which can message them back, unread until they open it", async () => {
    const slug = await study(`
beats:
  - id: jake-answers
    when: { participant: message, on: jake }
    delay: "0:02"
    do: { action: message, actor: jake, text: "who asked?" }
  - id: maya-checks-in
    when: { time: "0:00" }
    do: { action: message, actor: maya, text: "Hey, saw you joined!" }
`);
    const cookie = await join(slug);
    await call(cookie, "GET", "/feed");
    expect(await unread(cookie)).toBe(1);

    // A message to Maya doesn't set off Jake's beat.
    await send(cookie, "maya", "Thanks!");
    await send(cookie, "jake", "Why were you mean to Maya?");
    // Its two minutes pass.
    await hurry(2);
    const [latest, older] = await conversations(cookie);
    expect(latest).toMatchObject({
      with: { username: "jake" },
      last: { body: "who asked?", mine: false },
      unread: 1,
    });
    // Answering Maya isn't reading her message: only opening the conversation is.
    expect(older).toMatchObject({ with: { username: "maya" }, unread: 1 });
    expect(await unread(cookie)).toBe(2);

    expect((await thread(cookie, "jake")).messages.map(({ body, mine }) => [body, mine])).toEqual([
      ["Why were you mean to Maya?", true],
      ["who asked?", false],
    ]);
    expect(await unread(cookie)).toBe(1);

    const folder = mkdtempSync(path.join(tmpdir(), "truman-messages-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    const content = parse(readFileSync(path.join(folder, "content.csv"), "utf8"), {
      columns: true,
    }) as Record<string, string>[];
    const messages = new Map(
      content.filter(({ kind }) => kind === "message").map((row) => [row.body, row]),
    );
    expect(messages.get("who asked?")).toMatchObject({ author: "jake", origin: "world" });
    expect(messages.get("Why were you mean to Maya?")?.to).toBe("jake");
    expect(messages.get("who asked?")?.to).toBe(messages.get("Thanks!")?.author);
  });

  it("can be improvised, with the conversation so far", async () => {
    await study(`
live: { enabled: true, budgetUsd: 1 }
beats:
  - id: jake-answers
    when: { participant: message, on: jake }
    do:
      action: message
      actor: jake
      improvise: Brush it off as a joke
      fallback: lol relax
`).then(async (slug) => {
      const cookie = await join(slug);
      await send(cookie, "jake", "Why were you mean to Maya?");
      await unread(cookie);
      expect((await thread(cookie, "jake")).messages.map(({ body }) => body)).toEqual([
        "Why were you mean to Maya?",
        "relax, it was a joke",
      ]);
      const request = writer.calls.at(-1) as WriteRequest;
      expect(request.prompt).toContain("Your direct messages with");
      expect(request.prompt).toContain("Why were you mean to Maya?");
      expect(request.prompt).toContain("Write a direct message to the participant.");
    });
  });

  it("can't be what a beat comments on, likes, or reposts", async () => {
    // The study can't be saved with that beat.
    await expect(
      study(`
beats:
  - { id: like-it, when: { participant: message }, do: { action: comment, actor: jake, on: trigger, text: "Hi" } }
`),
    ).rejects.toThrow(/a message can't be commented on/);
  });
});
