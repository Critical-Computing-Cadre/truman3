import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder } from "@truman3/study-import";
import { parse } from "csv-parse/sync";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

const SLUG = "export-study";
const RECRUITMENT_ID = "PROLIFIC-SECRET-123";
const SECOND_ID = "PROLIFIC-SECOND-456";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

type Row = Record<string, string>;

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-export-"));
  dirs.push(dir);
  return dir;
}

async function enter(externalId: string) {
  const response = await app.request(`/studies/${SLUG}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId }),
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

const meta = () => ({ clientEventId: randomUUID(), occurredAt: new Date().toISOString() });

function send(cookie: string, url: string, body: object = {}) {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ ...meta(), ...body }),
  });
}

/** Runs an export and reads every CSV back. */
async function exported(options = {}) {
  const folder = path.join(tempDir(), "out");
  const result = await exportStudy(database.db, SLUG, folder, options);
  const read = (name: string): Row[] =>
    parse(readFileSync(path.join(folder, name), "utf8"), { columns: true });
  return {
    result,
    folder,
    participants: read("participants.csv"),
    summary: read("summary.csv"),
    events: read("events.csv"),
    impressions: read("impressions.csv"),
    content: read("content.csv"),
    codebook: readFileSync(path.join(folder, "codebook.md"), "utf8"),
  };
}

let scriptedPostId: string;

/** One participant does a known set of things, so the export can be checked against them. */
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

  const dir = tempDir();
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${SLUG}
title: Export test
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: prolific }
conditions:
  assignment: { method: blocked, blockSize: 2 }
  arms: [{ key: a, factors: { tone: warm } }, { key: b, factors: { tone: cold } }]
feed: { ranker: chronological }
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed, finishAfterMinutes: 0 }, { step: exit }]
`,
    "actors.csv": "username,name\nann,Ann\n",
    "posts.csv": [
      "id,body,actor,likes,time,condition",
      "p1,shared post,ann,3,-1:00,",
      "for-a,only a,ann,0,-0:30,a",
      "for-b,only b,ann,0,-0:30,b",
    ].join("\n"),
    "reactions.csv": "on,nth,type,actor,after,body\npost,0,reply,ann,0:00,Nice one\n",
  };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  const result = await importStudyFolder(database.db, storage, dir);
  if (result.status === "failed") {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }

  const cookie = await enter(RECRUITMENT_ID);
  const feed = (await (await app.request("/feed", { headers: { cookie } })).json()) as FeedResponse;
  const post = feed.posts.find((item) => item.body === "shared post");
  scriptedPostId = post?.id as string;

  await send(cookie, `/content/${scriptedPostId}/like`, { active: true });
  await send(cookie, `/content/${scriptedPostId}/like`, { active: false });
  await send(cookie, `/content/${scriptedPostId}/like`, { active: true });
  await send(cookie, `/content/${scriptedPostId}/flag`, { active: true });
  await send(cookie, `/content/${scriptedPostId}/comments`, { body: "=HYPERLINK(1)" });
  await send(cookie, "/actors/ann/relation", { action: "follow" });
  await send(cookie, "/actors/ann/relation", { action: "report", reason: "spam" });
  await send(cookie, "/events", {
    events: [
      {
        ...meta(),
        type: "content.viewed",
        targetContentId: scriptedPostId,
        payload: { dwellMs: 200, surface: "feed" },
      },
      {
        ...meta(),
        type: "content.viewed",
        targetContentId: scriptedPostId,
        payload: { dwellMs: 3000, surface: "feed" },
      },
      { ...meta(), type: "session.heartbeat", payload: { activeMs: 15000, page: "/" } },
    ],
  });

  const form = new FormData();
  for (const [key, value] of Object.entries({ ...meta(), body: "my own post" })) {
    form.append(key, value);
  }
  await app.request("/posts", { method: "POST", headers: { cookie }, body: form });

  const second = await enter(SECOND_ID);
  await app.request("/feed", { headers: { cookie: second } });
  const flow = (await (await app.request("/me/flow", { headers: { cookie: second } })).json()) as {
    position: number;
  };
  await send(second, "/me/flow/advance", { position: flow.position });
  await send(second, "/me/flow/advance", { position: flow.position + 1 });
});

afterAll(async () => {
  storage.close();
  await database.destroy();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("exportStudy", () => {
  it("reports an unknown study", async () => {
    expect(await exportStudy(database.db, "nope", tempDir())).toEqual({ status: "not-found" });
  });

  it("matches exactly what the participant did, including on scripted content", async () => {
    const { summary, participants } = await exported();
    const active = participants.find((row) => row.status === "active")!;
    const row = summary.find((item) => item.participant_id === active.participant_id)!;

    expect(row).toMatchObject({
      sessions: "1",
      posts_created: "1",
      comments_created: "1",
      content_liked: "1",
      like_actions: "2",
      content_flagged: "1",
      flag_actions: "1",
      actors_followed: "1",
      actors_blocked: "0",
      actors_reported: "1",
      content_views: "2",
      dwell_ms: "3200",
      views_excluded: "0",
      active_ms: "15000",
    });
  });

  it("applies dwell limits to the summary only, and says so", async () => {
    const { summary, events, participants, codebook } = await exported({ minDwellMs: 1500 });
    const active = participants.find((row) => row.status === "active")!;
    const row = summary.find((item) => item.participant_id === active.participant_id)!;

    expect(row).toMatchObject({ content_views: "1", dwell_ms: "3000", views_excluded: "1" });
    expect(
      events.filter((event) => event.type === "content.viewed").map((event) => event.dwell_ms),
    ).toEqual(["200", "3000"]);
    expect(codebook).toContain("from 1500 ms");
  });

  it("records assignment and factors for each participant", async () => {
    const { participants } = await exported();

    expect(participants).toHaveLength(2);
    expect(new Set(participants.map((row) => row.condition))).toEqual(new Set(["a", "b"]));
    for (const row of participants) {
      expect(row).toMatchObject({
        assignment_method: "blocked",
        assignment_probability: "0.5",
        study_version: "1",
      });
      expect(row.factor_tone).toBe(row.condition === "a" ? "warm" : "cold");
    }
  });

  it("shows who finished and who didn't", async () => {
    const { participants } = await exported();
    expect(participants.map((row) => row.status).sort()).toEqual(["active", "completed"]);
  });

  it("never includes recruitment IDs unless asked, and then only in their own file", async () => {
    const { folder, ...files } = await exported();
    const everything = JSON.stringify(files);

    expect(everything).not.toContain(RECRUITMENT_ID);
    expect(everything).not.toContain(SECOND_ID);

    const withIds = await exported({ includeRecruitmentIds: true });
    const links: Row[] = parse(
      readFileSync(path.join(withIds.folder, "recruitment_ids.csv"), "utf8"),
      { columns: true },
    );
    expect(links.map((row) => row.external_id).sort()).toEqual([RECRUITMENT_ID, SECOND_ID].sort());
    expect(folder).toBeTruthy();
  });

  it("includes events on scripted content, with the ID from the study definition", async () => {
    const { events } = await exported();
    const liked = events.find((event) => event.type === "content.liked");

    expect(liked).toMatchObject({
      target_content_id: scriptedPostId,
      target_content_ref: "p1",
      source: "participant",
    });
  });

  it("includes scripted reactions, marked as coming from the script", async () => {
    const { events } = await exported();
    expect(events.find((event) => event.type === "reaction.scheduled")).toMatchObject({
      source: "script",
      actor: "ann",
    });
  });

  it("records what was shown, and only what each condition should see", async () => {
    const { impressions, participants } = await exported();

    expect(impressions.length).toBeGreaterThan(0);
    for (const row of impressions) {
      const person = participants.find((item) => item.participant_id === row.participant_id);
      const other = person?.condition === "a" ? "for-b" : "for-a";
      expect(row.content_ref).not.toBe(other);
      expect(row.condition).toBe(person?.condition);
      expect(row.ranker).toBe("chronological");
    }
  });

  it("lists scripted and created content, and refers to participants by study ID", async () => {
    const { content, participants } = await exported();
    const active = participants.find((row) => row.status === "active")!;

    expect(content.find((row) => row.source_ref === "p1")).toMatchObject({
      origin: "scripted",
      author: "ann",
      base_likes: "3",
      offset_ms: "-3600000",
    });
    expect(content.find((row) => row.body === "my own post")).toMatchObject({
      origin: "world",
      participant_id: active.participant_id,
      author: `participant:${active.participant_id}`,
    });
  });

  it("makes participants' text safe to open in a spreadsheet", async () => {
    const { content, codebook } = await exported();

    expect(content.find((row) => row.body?.includes("HYPERLINK"))?.body).toBe("'=HYPERLINK(1)");
    expect(codebook).toContain("apostrophe");
  });

  it("counts people who declined or withdrew, without including them", async () => {
    const leaving = await enter("PROLIFIC-LEAVING-789");
    expect(leaving).toBeTruthy();
    const [row] = await database.db
      .select({ id: schema.participants.id })
      .from(schema.participants)
      .where(eq(schema.participants.externalId, "PROLIFIC-LEAVING-789"));
    await database.db.execute(
      sql`select delete_participant_data(${row!.id}, 'withdrew', 'researcher')`,
    );

    const { codebook, participants } = await exported();

    expect(codebook).toContain("0 declined consent, and 1 withdrew");
    expect(participants.map((item) => item.participant_id)).not.toContain(row!.id);
  });

  it("writes a codebook with the study's frozen settings and every file", async () => {
    const { codebook, result } = await exported();

    expect(result).toMatchObject({ status: "exported", participants: 2 });
    expect(codebook).toContain("Version 1");
    expect(codebook).toContain('"ranker": "chronological"');
    expect(codebook).toContain("content.liked");
    for (const file of [
      "participants.csv",
      "summary.csv",
      "events.csv",
      "impressions.csv",
      "content.csv",
    ]) {
      expect(codebook).toContain(file);
    }
  });
});
