import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addResearcherToTeam, setUpTeam } from "@truman3/accounts";
import type { FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { loadDraft } from "@truman3/drafts";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { standInWriter, type Writer } from "@truman3/writer";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

// A community written while the study runs, the same for everyone in a condition (ADR 102).

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];
const DAY = 24 * 60 * 60 * 1000;
let now = new Date();

/** Every day's prompt, to see what the model was told. */
const asked: string[] = [];

/** The stand-in, except that the second post on the first day there says something refused. */
const writer: Writer = {
  ...standInWriter(),
  async community(request) {
    asked.push(request.prompt);
    const day = await standInWriter().community(request);
    if (request.prompt.startsWith("Day 1,") && day.posts[1]) {
      day.posts[1].body = "Something unsafe.";
    }
    return day;
  },
};

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
    clock: () => now,
  });
});

afterAll(async () => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  storage.close();
  await database.destroy();
});

const call = (cookie: string, method: string, url: string, body?: object) =>
  app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

/** A lab with a two-condition study whose beats.yaml asks for a live community, launched. */
async function study(community: string, live = "") {
  now = new Date();
  const id = randomUUID().slice(0, 8);
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email: `${id}@example.edu`,
    name: "Owner",
  });
  const dir = mkdtempSync(path.join(tmpdir(), "truman-live-"));
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: live-${id}
title: Live community test
site: { name: Demo }
length: { days: 4 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: blocked, blockSize: 2 }
  arms: [{ key: calm }, { key: heated }]
flow: [{ step: feed }]
`,
    "actors.csv": "username,name,bio\nann,Ann,Bakes bread\nbo,Bo,Rides bikes\ncy,Cy,Reads maps\n",
    "posts.csv": "id,actor,time,body\nhello,ann,-0:10,A post the researcher wrote\n",
    "beats.yaml": `
${live}
community:
  live: true
  about: Neighbors in a small town, swapping news and recipes.
  postsPerDay: 2
  repliesPerPost: 1
  daysBefore: 1
  daysDuring: 3
${community}
beats: []
`,
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, { teamId });
  if (imported.status === "failed") {
    throw new Error(JSON.stringify(imported.issues));
  }
  const login = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${id}@example.edu`, password }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const [row] = await database.db
    .select({ id: schema.studies.id })
    .from(schema.studies)
    .where(eq(schema.studies.slug, `live-${id}`));
  const studyId = row?.id as string;
  const launch = () => call(cookie, "POST", `/admin/versions/${imported.studyVersionId}/launch`);
  return { id, cookie, studyId, slug: `live-${id}`, versionId: imported.studyVersionId, launch };
}

interface State {
  on: boolean;
  hold: boolean;
  spentUsd: number;
  own: { capUsd: number; participants: number; days: number; spentUsd: number } | null;
  whyNot: string | null;
  days: {
    id: string;
    condition: string;
    day: number;
    status: string;
    dropped: number;
    participant: string | null;
    answers: { actor: string; body: string }[];
    posts: { index: number; removed: boolean; body: string; replies: { body: string }[] }[];
  }[];
}

const stateOf = async (cookie: string, studyId: string) =>
  (await (await call(cookie, "GET", `/admin/studies/${studyId}/community`)).json()) as State;

/** Waits until this many days are written and nothing is still being written. */
async function written(cookie: string, studyId: string, count: number) {
  for (let tries = 0; tries < 100; tries++) {
    const state = await stateOf(cookie, studyId);
    if (state.days.length >= count && !state.days.some(({ status }) => status === "writing")) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`It never got to ${count} days.`);
}

/** Someone joins, and loads their feed. Asking twice gets both conditions, in turn. */
async function join(slug: string) {
  const entered = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId: randomUUID() }),
  });
  const cookie = (entered.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const feed = async () =>
    ((await (await call(cookie, "GET", "/feed")).json()) as FeedResponse).posts.map(
      ({ body }) => body,
    );
  return { cookie, feed };
}

const days = (state: State) =>
  state.days.map(({ condition, day, status }) => `${condition || "all"} ${day} ${status}`).sort();

describe("a live community", () => {
  it("is written at launch, then a day ahead of whoever is furthest along, and no further", async () => {
    const { cookie, studyId, slug, versionId, launch } = await study("");
    expect((await stateOf(cookie, studyId)).days).toEqual([]);
    expect((await launch()).status).toBe(200);
    // The day before anyone arrives, and their first day.
    const atLaunch = await written(cookie, studyId, 2);
    expect(days(atLaunch)).toEqual(["all -1 published", "all 0 published"]);
    expect(atLaunch.spentUsd).toBeCloseTo(0.12);
    // The line the check refused is left out, and counted.
    const first = atLaunch.days.find(({ day }) => day === 0);
    expect(first?.dropped).toBe(2);
    expect(JSON.stringify(first?.posts)).not.toContain("unsafe");

    // Someone arrives: they see the day before, and what the researcher wrote, and not tomorrow.
    const one = await join(slug);
    const seen = await one.feed();
    expect(seen).toContain("A post the researcher wrote");
    expect(seen).toContain("A stand-in post by ann, on day -1.");
    expect(seen.join()).not.toContain("on day 1.");
    // Their arriving has their second day written, ahead of them.
    expect(days(await written(cookie, studyId, 3))).toContain("all 1 published");
    expect(days(await stateOf(cookie, studyId))).toHaveLength(3);

    // A day later they see their first day's posts, and the last day is written.
    now = new Date(now.getTime() + DAY + 2 * 60 * 60 * 1000);
    expect(await one.feed()).toContain("A stand-in post by ann, on day 1.");
    const all = await written(cookie, studyId, 4);
    expect(days(all)).toEqual([
      "all -1 published",
      "all 0 published",
      "all 1 published",
      "all 2 published",
    ]);
    // The saved version is as it was. What was written is in their world, marked as written live,
    // and timed from when they arrived.
    const rows = await database.db
      .select()
      .from(schema.content)
      .where(
        and(eq(schema.content.studyVersionId, versionId), like(schema.content.sourceRef, "live-%")),
      );
    expect(rows.every(({ worldId }) => worldId !== null)).toBe(true);
    // The day before, their first day less the line that was refused, and their second.
    expect(rows.filter(({ kind }) => kind === "post")).toHaveLength(5);
    expect(rows[0]?.provenance).toMatchObject({
      origin: "generated",
      detail: { by: "community", live: true },
    });
    const [world] = await database.db
      .select({ startedAt: schema.worlds.startedAt })
      .from(schema.worlds)
      .where(eq(schema.worlds.id, rows[0]?.worldId as string));
    const second = rows.find(({ sourceRef }) => sourceRef === "live-all-d1-p0");
    expect(second?.visibleAt?.getTime()).toBe(
      (world?.startedAt.getTime() as number) + DAY + 60 * 60_000,
    );
    // Loading again doesn't copy anything twice.
    await one.feed();
    expect(
      await database.db.$count(
        schema.content,
        and(eq(schema.content.studyVersionId, versionId), like(schema.content.sourceRef, "live-%")),
      ),
    ).toBe(rows.length);
    // Someone who arrives later sees the same thing at the same point in their own study.
    const two = await join(slug);
    expect((await two.feed()).filter((body) => body.includes("stand-in"))).toEqual(
      seen.filter((body) => body.includes("stand-in")),
    );
  });

  it("can be a different community for each condition", async () => {
    const { cookie, studyId, slug, versionId, launch } = await study(`
  conditions:
    mode: each
    about: { calm: People are patient., heated: People argue. }
`);
    await launch();
    expect(days(await written(cookie, studyId, 4))).toEqual([
      "calm -1 published",
      "calm 0 published",
      "heated -1 published",
      "heated 0 published",
    ]);
    // Someone arriving has only their own condition's next day written.
    const one = await join(slug);
    await one.feed();
    const after = days(await written(cookie, studyId, 5));
    expect(after.filter((line) => line.includes(" 1 "))).toHaveLength(1);
    // And they have their own condition's days, and not the other's.
    const refs = await database.db
      .select({ sourceRef: schema.content.sourceRef })
      .from(schema.content)
      .where(
        and(eq(schema.content.studyVersionId, versionId), like(schema.content.sourceRef, "live-%")),
      );
    expect(new Set(refs.map(({ sourceRef }) => sourceRef?.split("-")[1])).size).toBe(1);
  });

  it("can hold each day for a researcher, who approves or skips it", async () => {
    const { id, cookie, studyId, slug, launch } = await study("  hold: true\n");
    await launch();
    const held = await written(cookie, studyId, 2);
    expect(days(held)).toEqual(["all -1 held", "all 0 held"]);
    const one = await join(slug);
    expect((await one.feed()).join()).not.toContain("stand-in");

    const [before, first] = [-1, 0].map((day) => held.days.find((row) => row.day === day)?.id);
    const decide = (who: string, dayId: string | undefined, decision: string) =>
      call(who, "POST", `/admin/studies/${studyId}/community/days/${dayId}`, { decision });
    // Not a viewer, or someone signed out.
    const email = `viewer-${id}@example.edu`;
    const added = await addResearcherToTeam(database.db, {
      teamSlug: `lab-${id}`,
      email,
      name: "Viewer",
      role: "viewer",
    });
    const login = await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: added.password }),
    });
    const viewer = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect((await decide(viewer, before, "approve")).status).toBe(403);
    expect((await decide("", before, "approve")).status).toBe(401);

    expect((await decide(cookie, before, "approve")).status).toBe(200);
    expect(await one.feed()).toContain("A stand-in post by ann, on day -1.");
    expect((await decide(cookie, first, "skip")).status).toBe(200);
    // Neither can be decided again.
    expect((await decide(cookie, before, "skip")).status).toBe(409);
    expect((await decide(cookie, first, "approve")).status).toBe(409);
    now = new Date(now.getTime() + DAY);
    expect((await one.feed()).join()).not.toContain("on day 1.");
  });

  it("lets a researcher take a post back out, with its replies", async () => {
    const { cookie, studyId, slug, launch } = await study("");
    await launch();
    const state = await written(cookie, studyId, 2);
    const before = state.days.find(({ day }) => day === -1);
    const [post, kept] = before?.posts ?? [];
    expect(post?.replies).toHaveLength(1);
    const one = await join(slug);
    expect(await one.feed()).toContain(post?.body);
    const remove = (who: string, index: number) =>
      call(who, "DELETE", `/admin/studies/${studyId}/community/days/${before?.id}/posts/${index}`);
    expect((await remove("", 0)).status).toBe(401);
    expect((await remove(cookie, 9)).status).toBe(404);
    expect((await remove(cookie, 0)).status).toBe(200);
    // It's gone for someone who had it, and never reaches someone who arrives later.
    expect(await one.feed()).not.toContain(post?.body);
    expect(await one.feed()).toContain(kept?.body);
    const two = await join(slug);
    expect(await two.feed()).not.toContain(post?.body);
    expect(await two.feed()).toContain(kept?.body);
    const after = await stateOf(cookie, studyId);
    expect(after.days.find(({ day }) => day === -1)?.posts.map(({ removed }) => removed)).toEqual([
      true,
      false,
    ]);
  });

  it("stops when the study's budget is used up, or live writing is paused", async () => {
    // Each day costs six cents here, so the second day uses up ten.
    const tight = await study("", "live: { budgetUsd: 0.1 }");
    await tight.launch();
    await written(tight.cookie, tight.studyId, 2);
    await (await join(tight.slug)).feed();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const stopped = await stateOf(tight.cookie, tight.studyId);
    expect(stopped.days).toHaveLength(2);
    expect(stopped.whyNot).toContain("budget of $0.1 is used up");

    const paused = await study("");
    await call(paused.cookie, "PUT", `/admin/studies/${paused.studyId}/christof`, {
      livePaused: true,
      pausedActors: [],
    });
    await paused.launch();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const quiet = await stateOf(paused.cookie, paused.studyId);
    expect(quiet.days).toEqual([]);
    expect(quiet.whyNot).toBe("Live writing is paused for this study.");
    // Turned back on, it starts when someone next loads their feed.
    await call(paused.cookie, "PUT", `/admin/studies/${paused.studyId}/christof`, {
      livePaused: false,
      pausedActors: [],
    });
    await (await join(paused.slug)).feed();
    expect((await written(paused.cookie, paused.studyId, 3)).whyNot).toBeNull();
  });
});

describe("a community of each participant's own (ADR 103)", () => {
  /** Posts as a participant. */
  const say = async (cookie: string, body: string) => {
    const form = new FormData();
    form.set("clientEventId", randomUUID());
    form.set("occurredAt", now.toISOString());
    form.set("body", body);
    const made = await app.request("/posts", { method: "POST", headers: { cookie }, body: form });
    expect(made.status).toBe(200);
  };
  /** Waits until this many days of participants' own are written. */
  async function ownDays(cookie: string, studyId: string, count: number) {
    for (let tries = 0; tries < 100; tries++) {
      const state = await stateOf(cookie, studyId);
      const theirs = state.days.filter(({ participant }) => participant);
      if (theirs.length >= count && theirs.every(({ status }) => status !== "writing")) {
        return { state, theirs };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`It never got to ${count} days of their own.`);
  }

  it("is their condition's up to their first day, then written for them, and answers what they post", async () => {
    const { cookie, studyId, slug, versionId, launch } = await study("  own: true\n");
    await launch();
    await written(cookie, studyId, 2);
    const one = await join(slug);
    expect(await one.feed()).toContain("A stand-in post by ann, on day -1.");
    await say(one.cookie, "My bike has a flat again");
    // On their first day nothing is written for them, and the shared one stops at that day.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(days(await stateOf(cookie, studyId))).toEqual(["all -1 published", "all 0 published"]);

    // They come back the next day: that day is written for them, told what they posted.
    now = new Date(now.getTime() + DAY + 60 * 60 * 1000);
    await one.feed();
    const { state, theirs } = await ownDays(cookie, studyId, 1);
    expect(theirs).toMatchObject([{ day: 1, status: "published", condition: "" }]);
    expect(theirs[0]?.answers).toEqual([
      { actor: "ann", body: "A stand-in answer to the participant." },
    ]);
    expect(state.own).toMatchObject({ capUsd: 0.5, participants: 1, days: 1 });
    expect(state.days.filter(({ participant }) => !participant)).toHaveLength(2);
    const prompt = asked.at(-1) ?? "";
    expect(prompt).toContain("0. My bike has a flat again");
    expect(prompt).toContain("A stand-in post by ann, on day 1.");
    expect(await one.feed()).toContain("A stand-in post by ann, on day 2.");

    // The answer is a reply under their own post, and they're told about it.
    const [theirPost] = await database.db
      .select({ id: schema.content.id, worldId: schema.content.worldId })
      .from(schema.content)
      .where(eq(schema.content.body, "My bike has a flat again"));
    const [answer] = await database.db
      .select()
      .from(schema.content)
      .where(
        and(
          eq(schema.content.studyVersionId, versionId),
          eq(schema.content.sourceRef, "live-own-d1-a0"),
        ),
      );
    expect(answer).toMatchObject({ parentId: theirPost?.id, kind: "comment" });
    const told = await database.db
      .select({ type: schema.notifications.type })
      .from(schema.notifications)
      .where(eq(schema.notifications.replyContentId, answer?.id as string));
    expect(told).toEqual([{ type: "reply" }]);

    // The next day carries on, and doesn't answer the same post twice.
    now = new Date(now.getTime() + DAY);
    await one.feed();
    await ownDays(cookie, studyId, 2);
    expect(asked.at(-1)).toContain("They haven't posted anything new.");
    expect(asked.at(-1)).toContain("- My bike has a flat again");

    // Someone else's is their own: nothing of the first person's reaches them.
    const two = await join(slug);
    now = new Date(now.getTime() + DAY + 60 * 60 * 1000);
    await two.feed();
    const both = await ownDays(cookie, studyId, 3);
    expect(both.state.own?.participants).toBe(2);
    expect(asked.at(-1)).not.toContain("My bike has a flat");
    // What was written for them reaches them the next time they load.
    await two.feed();
    const rows = await database.db
      .select({ worldId: schema.content.worldId })
      .from(schema.content)
      .where(
        and(
          eq(schema.content.studyVersionId, versionId),
          eq(schema.content.sourceRef, "live-own-d1-p0"),
        ),
      );
    expect(new Set(rows.map(({ worldId }) => worldId)).size).toBe(2);
  });

  it("stops for a participant at what one participant's can cost", async () => {
    // A day costs six cents here.
    const { cookie, studyId, slug, launch } = await study("  own: true\n  capUsd: 0.05\n");
    await launch();
    await written(cookie, studyId, 2);
    const one = await join(slug);
    await one.feed();
    now = new Date(now.getTime() + DAY + 60 * 60 * 1000);
    await one.feed();
    await ownDays(cookie, studyId, 1);
    now = new Date(now.getTime() + DAY);
    await one.feed();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await ownDays(cookie, studyId, 1)).theirs).toHaveLength(1);
    // Someone else still gets theirs.
    const two = await join(slug);
    await two.feed();
    now = new Date(now.getTime() + DAY + 60 * 60 * 1000);
    await two.feed();
    expect((await ownDays(cookie, studyId, 2)).state.own?.participants).toBe(2);
  });
});

describe("setting a live community in the builder", () => {
  it("saves it into beats.yaml, leaving the rest as it was", async () => {
    const { cookie, versionId } = await study("");
    const { draftId } = (await (
      await call(cookie, "POST", `/admin/versions/${versionId}/draft`)
    ).json()) as { draftId: string };
    const got = async () =>
      (await (await call(cookie, "GET", `/admin/drafts/${draftId}/community`)).json()) as {
        live: { live: boolean; hold: boolean; daysDuring: number; about: string } | null;
      };
    expect((await got()).live).toMatchObject({ live: true, hold: false, daysDuring: 3 });
    const save = (who: string, body: object) =>
      call(who, "PUT", `/admin/drafts/${draftId}/community/live`, body);
    const community = {
      live: true,
      hold: true,
      own: true,
      capUsd: 1,
      about: "A forum for people who fix old bicycles, and argue about tires.",
      topics: ["tires"],
      postsPerDay: 4,
      repliesPerPost: 2,
      daysBefore: 2,
      daysDuring: 5,
      cast: ["ann", "bo"],
      neverSay: [],
      conditions: { mode: "same" },
    };
    expect((await save("", community)).status).toBe(401);
    expect((await save(cookie, { ...community, daysDuring: 0 })).status).toBe(400);
    expect((await save(cookie, { ...community, about: "Short" })).status).toBe(400);
    expect((await save(cookie, community)).status).toBe(200);
    expect((await got()).live).toMatchObject({
      hold: true,
      own: true,
      capUsd: 1,
      daysDuring: 5,
      cast: ["ann", "bo"],
    });
    const text = (await loadDraft(database.db, draftId))?.pages["beats.yaml"] ?? "";
    expect(text).toContain("beats: []");
    expect(text).toContain("about: A forum for people who fix old bicycles");
  });
});
