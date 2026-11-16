import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FeedQuestion } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder, withdrawParticipant } from "@truman3/study-import";
import { parse } from "csv-parse/sync";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

// Questions a beat asks in the feed (ADR 89): asked when the beat is due, shown until answered or
// put aside, exported with the rest, and gone when the participant withdraws.

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

async function write(cookie: string, body: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...meta(), body })) {
    form.set(key, value);
  }
  await app.request("/posts", { method: "POST", headers: { cookie }, body: form });
}

const FELT = `
beats:
  - id: after-posting
    when: { participant: post }
    do:
      action: ask
      title: About your post
      questions:
        - { id: felt, text: How did posting that feel?, type: scale, max: 7, minLabel: Bad, maxLabel: Good }
        - { id: why, text: Why did you post it?, type: choice, choices: [To share, To be seen, No reason] }
`;

async function study(beats: string, extra = "", features = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-questions-"));
  dirs.push(dir);
  const slug = `questions-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Questions
site: { name: Demo }
length: { days: 1 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }]
platform: { style: text, template: shortPosts${features} }
feed: { ranker: chronological }
flow: [{ step: feed }, { step: exit }]
${extra}`,
    "actors.csv": "username,name\nann,Ann\n",
    "posts.csv": "id,body,actor,time\np1,Hello from Ann,ann,-1:00\n",
    "beats.yaml": beats,
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

const waiting = async (cookie: string) =>
  ((await (await call(cookie, "GET", "/questions")).json()) as { questions: FeedQuestion[] })
    .questions;
const eventsOf = async (type: string) =>
  database.db.select().from(schema.events).where(eq(schema.events.type, type));

describe("a question a beat asks in the feed", () => {
  it("isn't there until the beat happens, and is there as soon as it has", async () => {
    const cookie = await join(await study(FELT));
    expect(await waiting(cookie)).toEqual([]);
    await write(cookie, "My first post");
    // Asking for questions is enough. They needn't load the feed again first.
    const [asked, ...others] = await waiting(cookie);
    expect(others).toEqual([]);
    expect(asked).toMatchObject({ title: "About your post", required: false });
    expect(asked?.questions.map(({ id, type }) => [id, type])).toEqual([
      ["felt", "scale"],
      ["why", "choice"],
    ]);
  });

  it("takes an answer, once, and then stops asking", async () => {
    const cookie = await join(await study(FELT));
    await write(cookie, "Answered");
    const [asked] = await waiting(cookie);
    const shownAt = new Date(Date.now() - 4200).toISOString();
    const answer = { ...meta(), answers: { felt: 6, why: "To share" }, shownAt };
    const url = `/questions/${asked?.id}/answer`;
    expect((await call(cookie, "POST", url, answer)).status).toBe(200);
    // Pressed twice on a slow connection: still one answer.
    expect((await call(cookie, "POST", url, { ...answer, ...meta() })).status).toBe(200);
    expect(await waiting(cookie)).toEqual([]);

    const [row] = await database.db
      .select()
      .from(schema.beatAsks)
      .where(eq(schema.beatAsks.id, asked?.id as string));
    expect(row?.answers).toEqual({ felt: 6, why: "To share" });
    expect(row?.answeredAt).toBeInstanceOf(Date);
    expect(row?.tookMs).toBeGreaterThanOrEqual(4200);
    expect(row?.tookMs).toBeLessThan(60_000);
    const recorded = (await eventsOf("question.answered")).filter(
      ({ worldId }) => worldId === row?.worldId,
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.payload).toMatchObject({
      beat: "after-posting",
      answers: { felt: 6, why: "To share" },
    });
  });

  it("refuses an answer that leaves a question out, or isn't one it offered", async () => {
    const cookie = await join(await study(FELT));
    await write(cookie, "Half answered");
    const [asked] = await waiting(cookie);
    const url = `/questions/${asked?.id}/answer`;
    for (const answers of [
      { felt: 6 },
      { felt: 8, why: "To share" },
      { felt: 6, why: "For money" },
      { felt: 6, why: "To share", extra: "x" },
    ]) {
      const refused = await call(cookie, "POST", url, { ...meta(), answers });
      expect(refused.status).toBe(400);
    }
    expect(await waiting(cookie)).toHaveLength(1);
  });

  it("can be put aside, which is recorded, unless it's required", async () => {
    const optional = await join(await study(FELT));
    await write(optional, "Not now");
    const [asked] = await waiting(optional);
    expect((await call(optional, "POST", `/questions/${asked?.id}/dismiss`, meta())).status).toBe(
      200,
    );
    expect(await waiting(optional)).toEqual([]);
    const [row] = await database.db
      .select()
      .from(schema.beatAsks)
      .where(eq(schema.beatAsks.id, asked?.id as string));
    expect(row?.dismissedAt).toBeInstanceOf(Date);
    expect(row?.answers).toBeNull();

    const required = await join(
      await study(`
beats:
  - id: must
    when: { participant: post }
    do: { action: ask, required: true, questions: [{ id: one, text: In a word?, type: text }] }
`),
    );
    await write(required, "Has to answer");
    const [must] = await waiting(required);
    expect(must?.required).toBe(true);
    expect((await call(required, "POST", `/questions/${must?.id}/dismiss`, meta())).status).toBe(
      400,
    );
    expect(await waiting(required)).toHaveLength(1);
  });

  it("is only theirs to answer", async () => {
    const slug = await study(FELT);
    const mine = await join(slug);
    const theirs = await join(slug);
    await write(mine, "Mine");
    const [asked] = await waiting(mine);
    const answer = { ...meta(), answers: { felt: 1, why: "No reason" } };
    expect((await call(theirs, "POST", `/questions/${asked?.id}/answer`, answer)).status).toBe(404);
    expect(await waiting(theirs)).toEqual([]);
    expect(await waiting(mine)).toHaveLength(1);
  });

  it("can be asked at a set time, and each time something happens, up to a limit", async () => {
    const cookie = await join(
      await study(`
beats:
  - id: at-start
    when: { time: "0:00" }
    do: { action: ask, questions: [{ id: mood, text: How are you?, type: scale }] }
  - id: each-post
    when: { participant: post }
    max: 2
    do: { action: ask, questions: [{ id: more, text: Any more to say?, type: choices, choices: [Yes, No, Maybe] }] }
`),
    );
    expect((await waiting(cookie)).map(({ questions }) => questions[0]?.id)).toEqual(["mood"]);
    await write(cookie, "One");
    await write(cookie, "Two");
    await write(cookie, "Three");
    expect((await waiting(cookie)).map(({ questions }) => questions[0]?.id)).toEqual([
      "mood",
      "more",
      "more",
    ]);
  });

  it("does nothing where the feature's off, and says why in the beat's record", async () => {
    const cookie = await join(await study(FELT, "", ", features: { questions: false }"));
    await write(cookie, "Nobody asks");
    expect((await call(cookie, "GET", "/questions")).status).toBe(403);
    await call(cookie, "GET", "/feed");
    const runs = await database.db.select().from(schema.beatRuns);
    expect(
      runs.find(({ beat, reason }) => beat === "after-posting" && reason?.includes("questions")),
    ).toMatchObject({ status: "skipped", reason: "questions is off in this condition" });
  });

  it("is in the download, a row for each question, answered or not", async () => {
    const slug = await study(FELT);
    const answered = await join(slug);
    const silent = await join(slug);
    for (const cookie of [answered, silent]) {
      await write(cookie, "Asked");
    }
    const [asked] = await waiting(answered);
    await waiting(silent);
    await call(answered, "POST", `/questions/${asked?.id}/answer`, {
      ...meta(),
      answers: { felt: 2, why: "To be seen" },
    });

    const folder = mkdtempSync(path.join(tmpdir(), "truman-questions-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    const rows = parse(readFileSync(path.join(folder, "answers.csv"), "utf8"), {
      columns: true,
    }) as Record<string, string>[];
    expect(rows).toHaveLength(4);
    expect(rows.filter(({ status }) => status === "answered")).toMatchObject([
      { beat: "after-posting", question: "felt", type: "scale", answer: "2", run: "0" },
      { question: "why", text: "Why did you post it?", answer: "To be seen" },
    ]);
    expect(rows.filter(({ status }) => status === "unanswered")).toMatchObject([
      { question: "felt", answer: "", answered_at: "" },
      { question: "why", answer: "" },
    ]);
    expect(new Set(rows.map(({ participant_id }) => participant_id)).size).toBe(2);
    const codebook = readFileSync(path.join(folder, "codebook.md"), "utf8");
    expect(codebook).toContain("answers.csv");
    expect(codebook).toContain("question.answered");
  });

  it("goes when the participant withdraws", async () => {
    const slug = await study(FELT);
    const externalId = randomUUID();
    const cookie = await join(slug, externalId);
    await write(cookie, "Then withdrew");
    const [asked] = await waiting(cookie);
    await call(cookie, "POST", `/questions/${asked?.id}/answer`, {
      ...meta(),
      answers: { felt: 3, why: "No reason" },
    });
    const before = await database.db
      .select()
      .from(schema.beatAsks)
      .where(eq(schema.beatAsks.id, asked?.id as string));
    expect(before).toHaveLength(1);
    await withdrawParticipant(database.db, storage, {
      slug,
      externalId,
      reason: "test",
      requestedBy: "test",
    });
    const after = await database.db
      .select()
      .from(schema.beatAsks)
      .where(eq(schema.beatAsks.id, asked?.id as string));
    expect(after).toEqual([]);
    const left = (await eventsOf("question.answered")).filter(
      ({ worldId }) => worldId === before[0]?.worldId,
    );
    expect(left).toEqual([]);
  });
});
