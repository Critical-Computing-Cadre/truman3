import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import type { ConversationsResponse, FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { loadStudyFolder } from "@truman3/study-files";
import { importStudyFolder, withdrawParticipant } from "@truman3/study-import";
import { parse } from "csv-parse/sync";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createLive, type LiveEvent } from "./live.ts";
import { loadWorldContext } from "./participants/session.ts";
import { runScenarios } from "./scenarios/run.ts";
import { simulate } from "./scenarios/simulate.ts";

/** Shared worlds: several participants in one world, who see each other. ADR 67. */

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
let live: ReturnType<typeof createLive>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
  live = createLive({ db: database.db, writer: null });
  app = createApp({
    live,
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

/** Each study made here, by slug: its folder, and the version imported from it. */
const made = new Map<string, { dir: string; versionId: string }>();

async function study(teamId?: string, extra: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-shared-"));
  dirs.push(dir);
  const slug = `shared-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Shared
site: { name: Commons }
length: { days: 1 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }, { key: b }]
worlds: { size: 2, waitMinutes: 10 }
platform: { style: mixed, template: classic, features: { messages: true } }
feed: { ranker: chronological }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name,moderator\nbob,Bob,\nmod,Mod,yes\n",
    "posts.csv": "id,body,actor,time\np1,Welcome,bob,-1:00\n",
    "beats.yaml": `
beats:
  - { id: bob-greets, when: { time: "0:01" }, do: { action: post, actor: bob, text: Hello everyone } }
  - { id: bob-likes, when: { participant: post }, do: { action: like, actor: bob, on: trigger } }
`,
  };
  for (const [name, text] of Object.entries({ ...files, ...extra })) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, {
    launch: true,
    ...(teamId ? { teamId } : {}),
  });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  made.set(slug, { dir, versionId: imported.studyVersionId });
  return slug;
}

async function join(slug: string) {
  const externalId = randomUUID();
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId }),
  });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const call = (method: string, url: string, body?: object) =>
    app.request(url, {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const json = async <T>(method: string, url: string, body?: object) =>
    (await (await call(method, url, body)).json()) as T;
  const me = await json<{ username: string }>("GET", "/me");
  const post = async (text: string) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...meta(), body: text })) {
      form.set(key, value);
    }
    const made = await app.request("/posts", { method: "POST", headers: { cookie }, body: form });
    return ((await made.json()) as { id: string }).id;
  };
  return {
    externalId,
    username: me.username,
    call,
    json,
    post,
    flow: () =>
      json<{ step: string; waiting?: { joined: number; size: number } }>("GET", "/me/flow"),
    feed: async () => (await json<FeedResponse>("GET", "/feed")).posts,
  };
}

/** Where someone is: their world, and their condition. */
async function placeOf(externalId: string) {
  const [row] = await database.db
    .select({
      worldId: schema.worldMemberships.worldId,
      actorId: schema.worldMemberships.actorId,
      condition: schema.conditions.key,
      method: schema.assignments.method,
    })
    .from(schema.participants)
    .innerJoin(
      schema.worldMemberships,
      eq(schema.worldMemberships.participantId, schema.participants.id),
    )
    .innerJoin(schema.assignments, eq(schema.assignments.participantId, schema.participants.id))
    .innerJoin(schema.conditions, eq(schema.conditions.id, schema.assignments.conditionId))
    .where(eq(schema.participants.externalId, externalId));
  return row as NonNullable<typeof row>;
}

describe("a shared world", () => {
  it("waits for people, then puts them together in one condition, seeing each other", async () => {
    const slug = await study();
    const ann = await join(slug);
    expect((await ann.flow()).waiting).toEqual(expect.objectContaining({ joined: 1, size: 2 }));

    const cal = await join(slug);
    // Full, it starts for both at once.
    expect((await ann.flow()).waiting).toBeUndefined();
    expect((await cal.flow()).waiting).toBeUndefined();
    const [annPlace, calPlace] = [await placeOf(ann.externalId), await placeOf(cal.externalId)];
    expect(calPlace.worldId).toBe(annPlace.worldId);
    expect(calPlace.condition).toBe(annPlace.condition);
    expect(calPlace.method).toBe("world");

    // A third person starts a new world, since that one's full.
    const dee = await join(slug);
    expect((await placeOf(dee.externalId)).worldId).not.toBe(annPlace.worldId);
    expect((await dee.flow()).waiting).toEqual(expect.objectContaining({ joined: 1 }));

    // They see each other's posts, and what they do to each other notifies them.
    const postId = await ann.post("Hi, I'm Ann");
    expect((await cal.feed()).map(({ body }) => body)).toContain("Hi, I'm Ann");
    expect((await dee.feed()).map(({ body }) => body)).not.toContain("Hi, I'm Ann");
    await cal.call("POST", `/content/${postId}/like`, { ...meta(), active: true });
    await cal.call("POST", `/content/${postId}/comments`, { ...meta(), body: "Hi Ann!" });
    const { notifications } = await ann.json<{ notifications: { type: string }[] }>(
      "GET",
      "/notifications",
    );
    expect(notifications.map(({ type }) => type)).toEqual(
      expect.arrayContaining(["like", "reply"]),
    );

    // They can message each other.
    expect(
      (await cal.call("POST", `/messages/${ann.username}`, { ...meta(), body: "Hey" })).status,
    ).toBe(200);
    const { conversations } = await ann.json<ConversationsResponse>("GET", "/messages");
    expect(conversations[0]).toMatchObject({ last: { body: "Hey" }, unread: 1 });
  });

  it("has beats once for the world, or once for each participant", async () => {
    const slug = await study();
    const ann = await join(slug);
    const cal = await join(slug);
    const { worldId } = await placeOf(ann.externalId);

    await ann.post("Ann's post");
    await cal.post("Cal's post");
    // Two minutes on, Bob's greeting is due.
    await database.db
      .update(schema.worlds)
      .set({ startedAt: sql`${schema.worlds.startedAt} - interval '2 minutes'` })
      .where(eq(schema.worlds.id, worldId));
    await ann.feed();
    await cal.feed();

    const runs = await database.db
      .select()
      .from(schema.beatRuns)
      .where(and(eq(schema.beatRuns.worldId, worldId), eq(schema.beatRuns.status, "fired")));
    const greets = runs.filter(({ beat }) => beat === "bob-greets");
    const likes = runs.filter(({ beat }) => beat === "bob-likes");
    expect(greets).toHaveLength(1);
    expect(greets[0]?.forActorId).toBeNull();
    // Bob likes each of their posts: the beat is theirs, once each.
    expect(new Set(likes.map(({ forActorId }) => forActorId)).size).toBe(2);
    const feed = await cal.feed();
    expect(feed.filter(({ body }) => body === "Hello everyone")).toHaveLength(1);
    expect(feed.find(({ body }) => body === "Ann's post")?.likes).toBe(1);
  });

  it("when someone withdraws, what they wrote leaves everyone's feed, and the world stays", async () => {
    const slug = await study();
    const ann = await join(slug);
    const cal = await join(slug);
    const postId = await ann.post("Ann was here");
    await cal.call("POST", `/content/${postId}/comments`, { ...meta(), body: "Hi Ann" });
    await cal.post("Cal's own post");

    const result = await withdrawParticipant(database.db, storage, {
      slug,
      externalId: ann.externalId,
      reason: "asked to",
      requestedBy: "test",
    });
    expect(result.status).toBe("withdrawn");

    const bodies = (await cal.feed()).map(({ body }) => body);
    expect(bodies).not.toContain("Ann was here");
    expect(bodies).toContain("Cal's own post");
    // The export keeps Cal's reply, and says Ann's post is gone, and whose world was whose.
    const folder = mkdtempSync(path.join(tmpdir(), "truman-shared-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    const read = (name: string): Record<string, string>[] =>
      parse(readFileSync(path.join(folder, name), "utf8"), { columns: true });
    const content = read("content.csv").filter(({ origin }) => origin === "world");
    const calPlace = await placeOf(cal.externalId);
    const [calRow] = read("participants.csv");
    expect(calRow?.world_id).toBe(calPlace.worldId);
    const annPost = content.find(({ content_id }) => content_id === postId);
    expect(annPost).toMatchObject({
      withdrawn: "true",
      body: "",
      author: "withdrawn",
      participant_id: "",
    });
    const reply = content.find(({ body }) => body === "Hi Ann");
    expect(reply).toMatchObject({
      participant_id: calRow?.participant_id,
      parent_id: postId,
      withdrawn: "",
    });

    // Liking what's gone isn't possible.
    expect(
      (await cal.call("POST", `/content/${postId}/like`, { ...meta(), active: true })).status,
    ).toBe(404);
  });
});

describe("live updates", () => {
  /** Listens as someone, and keeps what they're told. */
  async function listenAs(externalId: string) {
    const { worldId, actorId } = await placeOf(externalId);
    const context = await loadWorldContext(database.db, worldId, actorId);
    const events: LiveEvent[] = [];
    const stop = live.listen(context as NonNullable<typeof context>, (event) => events.push(event));
    return { events, stop };
  }

  it("tells each participant what's new for them, and nothing about what they did", async () => {
    const slug = await study();
    const ann = await join(slug);
    const cal = await join(slug);
    const annHears = await listenAs(ann.externalId);
    const calHears = await listenAs(cal.externalId);
    await live.tick(new Date());
    annHears.events.length = 0;
    calHears.events.length = 0;

    const postId = await cal.post("Cal posts");
    await live.tick(new Date());
    expect(annHears.events).toEqual([{ type: "feed", posts: true }]);
    // Bob liked Cal's post: that's Cal's notification.
    expect(calHears.events).toEqual([{ type: "notifications" }]);

    annHears.events.length = 0;
    calHears.events.length = 0;
    await ann.call("POST", `/content/${postId}/comments`, { ...meta(), body: "Nice" });
    await ann.call("POST", `/messages/${cal.username}`, { ...meta(), body: "Hey Cal" });
    await live.tick(new Date());
    expect(annHears.events).toEqual([]);
    expect(calHears.events).toEqual(
      expect.arrayContaining([
        { type: "feed", posts: false },
        { type: "notifications" },
        { type: "messages" },
      ]),
    );
    // Told once, though the looks overlap.
    calHears.events.length = 0;
    await live.tick(new Date());
    expect(calHears.events).toEqual([]);

    // Two minutes on, Bob's greeting happens without anyone loading a page.
    annHears.events.length = 0;
    await live.tick(new Date(Date.now() + 2 * 60_000));
    expect(annHears.events).toEqual([{ type: "feed", posts: true }]);
    const { worldId } = await placeOf(ann.externalId);
    const [greeting] = await database.db
      .select()
      .from(schema.beatRuns)
      .where(and(eq(schema.beatRuns.worldId, worldId), eq(schema.beatRuns.beat, "bob-greets")));
    expect(greeting?.status).toBe("fired");
    annHears.stop();
    calHears.stop();
    expect(live.listenersIn((await placeOf(ann.externalId)).worldId)).toBe(0);
  });

  it("streams to a participant in a shared world, and not to anyone on their own", async () => {
    const slug = await study();
    const ann = await join(slug);
    const cal = await join(slug);
    const response = await ann.call("GET", "/live");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const { worldId } = await placeOf(ann.externalId);
    await expect.poll(() => live.listenersIn(worldId)).toBe(1);

    await cal.post("Hello Ann");
    await live.tick(new Date());
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain("event: feed");
    await reader.cancel();

    const nobody = await app.request("/live");
    expect(nobody.status).toBe(401);
  });
});

describe("removing what someone wrote, live", () => {
  it("shows a researcher what's being written, and takes it down for everyone as the moderator", async () => {
    const id = randomUUID().slice(0, 8);
    const email = `${id}@example.edu`;
    const { teamId, password } = await setUpTeam(database.db, {
      teamName: `lab-${id}`,
      slug: `lab-${id}`,
      email,
      name: "Owner",
    });
    const login = await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const researcher = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const asResearcher = (method: string, url: string, body?: object) =>
      app.request(url, {
        method,
        headers: { "content-type": "application/json", cookie: researcher },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

    const slug = await study(teamId);
    const [row] = await database.db
      .select({ id: schema.studies.id })
      .from(schema.studies)
      .where(eq(schema.studies.slug, slug));
    const studyId = row?.id as string;
    const ann = await join(slug);
    const cal = await join(slug);
    const postId = await ann.post("Something unkind");

    const watched = (await (
      await asResearcher("GET", `/admin/studies/${studyId}/live`)
    ).json()) as {
      worlds: { people: number }[];
      content: { id: string; body: string; author: string; removed: boolean }[];
      moderator: string | null;
    };
    expect(watched.worlds).toEqual([expect.objectContaining({ people: 2 })]);
    expect(watched.moderator).toBe("mod");
    expect(watched.content).toEqual([
      expect.objectContaining({
        id: postId,
        body: "Something unkind",
        author: ann.username,
        removed: false,
      }),
    ]);

    const removed = await asResearcher("POST", `/admin/studies/${studyId}/live/${postId}/remove`, {
      reason: "Keep it kind",
    });
    expect(removed.status).toBe(200);
    // Cal sees a moderator's removal, though this study has removal off, and Ann is told.
    const seen = (await cal.feed()).find(({ id }) => id === postId);
    expect(seen).toMatchObject({ body: "", removed: { by: "Mod", reason: "Keep it kind" } });
    const { notifications } = await ann.json<{ notifications: { type: string }[] }>(
      "GET",
      "/notifications",
    );
    expect(notifications.map(({ type }) => type)).toContain("remove");
    const after = (await (await asResearcher("GET", `/admin/studies/${studyId}/live`)).json()) as {
      content: { removed: boolean }[];
    };
    expect(after.content[0]?.removed).toBe(true);
  });
});

describe("testing a shared world", () => {
  it("runs a scenario with several participants, each with their own view and beats", async () => {
    const slug = await study(undefined, {
      "scenarios.yaml": `
scenarios:
  - name: Ann posts, Cal answers, and Bob likes only Ann's
    condition: a
    participants: [ann, cal]
    steps:
      - { at: "0:01", post: Ann here }
      - { at: "0:02", as: cal, comment: Hi Ann, on: { participant: ann } }
      - { at: "0:03", as: cal, message: Hello, to: ann }
      - at: "0:04"
        expect: { happened: [bob-likes], sees: [Hi Ann, Hello] }
      - at: "0:04"
        as: cal
        expect: { notHappened: [bob-likes], sees: [Ann here] }
`,
    });
    const { dir, versionId } = made.get(slug) as { dir: string; versionId: string };
    const { definition } = loadStudyFolder(dir);
    const results = await runScenarios({
      db: database.db,
      storage,
      versionId,
      scenarios: definition?.scenarios ?? [],
      cleanUp: true,
    });
    expect(results).toEqual([expect.objectContaining({ passed: true, problems: [] })]);
    // Cleaning up after the last of them takes their world too.
    const left = await database.db
      .select()
      .from(schema.worlds)
      .where(and(eq(schema.worlds.studyVersionId, versionId), eq(schema.worlds.mode, "shared")));
    expect(left).toEqual([]);
  });

  it("simulates participants together, in worlds of the study's size", async () => {
    const slug = await study();
    const { versionId } = made.get(slug) as { dir: string; versionId: string };
    const report = await simulate({
      db: database.db,
      storage,
      versionId,
      settings: { participants: 5, seed: 7 },
    });
    expect(report.participants).toBe(5);
    expect(report.problems).toEqual([]);
    const worlds = await database.db
      .select({ id: schema.worlds.id, people: sql<number>`count(*)::int` })
      .from(schema.worlds)
      .innerJoin(schema.worldMemberships, eq(schema.worldMemberships.worldId, schema.worlds.id))
      .where(eq(schema.worlds.studyVersionId, versionId))
      .groupBy(schema.worlds.id);
    expect(worlds.map(({ people }) => people).sort()).toEqual([1, 2, 2]);
    // What they wrote is in their shared worlds.
    const byParticipants = await database.db
      .select({ worldId: schema.content.worldId })
      .from(schema.content)
      .innerJoin(schema.actors, eq(schema.actors.id, schema.content.authorActorId))
      .where(and(eq(schema.content.studyVersionId, versionId), eq(schema.actors.driver, "human")));
    expect(byParticipants.length).toBeGreaterThan(0);
  });
});
