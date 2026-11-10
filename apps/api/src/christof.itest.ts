import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FeedPost, FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder, withdrawParticipant } from "@truman3/study-import";
import { parse } from "csv-parse/sync";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];
const ROOT = path.resolve(import.meta.dirname, "../../..");

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
const act = (cookie: string, id: string, action: string, body: object = {}) =>
  call(cookie, "POST", `/content/${id}/${action}`, { ...meta(), ...body });

async function join(slug: string, externalId = randomUUID()) {
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId }),
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

const feed = async (cookie: string) =>
  ((await (await call(cookie, "GET", "/feed")).json()) as FeedResponse).posts;
const byBody = (posts: FeedPost[], body: string) =>
  posts.find((post) => post.body === body) as FeedPost;

/** Whose world a session is, and which condition they're in. */
async function worldOf(cookie: string) {
  const { username } = (await (await call(cookie, "GET", "/me")).json()) as { username: string };
  const [row] = await database.db
    .select({ worldId: schema.actors.worldId, key: schema.conditions.key })
    .from(schema.actors)
    .innerJoin(schema.worldMemberships, eq(schema.worldMemberships.actorId, schema.actors.id))
    .innerJoin(
      schema.assignments,
      eq(schema.assignments.participantId, schema.worldMemberships.participantId),
    )
    .innerJoin(schema.conditions, eq(schema.conditions.id, schema.assignments.conditionId))
    .where(eq(schema.actors.username, username));
  return { worldId: row?.worldId as string, condition: row?.key as string };
}

/** Moves a world this many minutes into its future, with whatever is waiting in it. */
async function advance(cookie: string, minutes: number) {
  const { worldId } = await worldOf(cookie);
  const by = sql`interval '1 minute' * ${minutes}`;
  await database.db
    .update(schema.worlds)
    .set({ startedAt: sql`${schema.worlds.startedAt} - ${by}` })
    .where(eq(schema.worlds.id, worldId));
  await database.db
    .update(schema.beatRuns)
    .set({
      dueAt: sql`${schema.beatRuns.dueAt} - ${by}`,
      triggeredAt: sql`${schema.beatRuns.triggeredAt} - ${by}`,
    })
    .where(and(eq(schema.beatRuns.worldId, worldId), eq(schema.beatRuns.status, "pending")));
}

const runsIn = async (cookie: string) => {
  const { worldId } = await worldOf(cookie);
  return database.db
    .select()
    .from(schema.beatRuns)
    .where(eq(schema.beatRuns.worldId, worldId))
    .orderBy(schema.beatRuns.dueAt);
};

async function importFolder(folder: string) {
  const imported = await importStudyFolder(database.db, storage, folder, { launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  return imported;
}

describe("the bystander reference study", () => {
  let slug: string;
  beforeAll(async () => {
    // Imported under its own name each time, so the tests don't share participants.
    const dir = mkdtempSync(path.join(tmpdir(), "truman-bystander-"));
    dirs.push(dir);
    const source = path.join(ROOT, "studies/examples/bystander");
    for (const name of ["actors.csv", "posts.csv", "comments.csv", "beats.yaml"]) {
      writeFileSync(path.join(dir, name), readFileSync(path.join(source, name)));
    }
    slug = `bystander-${randomUUID().slice(0, 8)}`;
    writeFileSync(
      path.join(dir, "study.yaml"),
      readFileSync(path.join(source, "study.yaml"), "utf8")
        .replace("slug: bystander", `slug: ${slug}`)
        .replace(/flow:[\s\S]*$/, "flow: [{ step: feed }, { step: exit }]\n"),
    );
    await import("node:fs").then(({ cpSync }) =>
      cpSync(path.join(source, "media"), path.join(dir, "media"), { recursive: true }),
    );
    await importFolder(dir);
  });

  /** One participant in each condition, since blocks of two give one of each. */
  const both = async () => {
    const first = await join(slug);
    const second = await join(slug);
    const cookies = { [(await worldOf(first)).condition]: first };
    cookies[(await worldOf(second)).condition] = second;
    return cookies as { defended: string; silent: string };
  };

  it("plays out a pile-on, and someone steps in only in 'defended'", async () => {
    const { defended, silent } = await both();
    for (const cookie of [defended, silent]) {
      await feed(cookie);
      await advance(cookie, 10);
    }

    const art = (cookie: string) =>
      feed(cookie).then((posts) => byBody(posts, "Finished my first real painting! Be nice lol"));
    const shown = async (cookie: string) => (await art(cookie)).comments.map(({ body }) => body);
    expect(await shown(silent)).toEqual([
      "lol my little brother paints better than this",
      "seriously why would you even post this",
    ]);
    expect(await shown(defended)).toEqual([
      "lol my little brother paints better than this",
      "seriously why would you even post this",
      "Not cool, Jake. It's her first painting. Maya, I love the colors!",
    ]);

    // In "silent", someone likes the mocking comment instead.
    const mocking = (await art(silent)).comments[0];
    expect(mocking?.likes).toBe(1);
    expect((await art(defended)).comments[0]?.likes).toBe(0);

    const statuses = (await runsIn(defended)).map(({ beat, status }) => `${beat}:${status}`);
    expect(statuses).toEqual(["jake-mocks:fired", "jake-piles-on:fired", "sam-defends:fired"]);
  });

  it("answers a participant who replies to the bully, and Sam stays out of it", async () => {
    const { defended } = await both();
    await feed(defended);
    await advance(defended, 3.5);
    const [mocking] = (
      await feed(defended).then((posts) =>
        byBody(posts, "Finished my first real painting! Be nice lol"),
      )
    ).comments;
    expect(mocking?.body).toBe("lol my little brother paints better than this");
    expect(
      (await act(defended, mocking?.id as string, "comments", { body: "Leave her alone" })).status,
    ).toBe(200);

    await advance(defended, 10);
    const runs = await runsIn(defended);
    const answer = runs.find(({ beat }) => beat === "jake-answers-participant");
    const sam = runs.find(({ beat }) => beat === "sam-defends");
    expect(answer?.status).toBe("fired");
    // Sam only holds back if the participant's exchange with Jake came first.
    expect(sam?.status).toBe((answer?.dueAt as Date) <= (sam?.dueAt as Date) ? "skipped" : "fired");
    if (sam?.status === "skipped") {
      expect(sam.reason).toBe('"jake-answers-participant" had already happened');
    }

    const { notifications } = (await (await call(defended, "GET", "/notifications")).json()) as {
      notifications: { type: string; replyBody: string | null }[];
    };
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "reply", replyBody: "relax, it's a joke" }),
      ]),
    );
  });

  it("thanks a participant who comments on Maya's post, and records each decision", async () => {
    const { defended } = await both();
    const posts = await feed(defended);
    const art = byBody(posts, "Finished my first real painting! Be nice lol");
    await act(defended, art.id, "comments", { body: "This is lovely!" });
    await advance(defended, 4);
    const mine = byBody(await feed(defended), "Finished my first real painting! Be nice lol");
    const kind = mine.comments.find(({ body }) => body === "This is lovely!");
    expect(kind?.likes).toBe(1);
    // With live writing off, Maya's world draws one of her rehearsed lines.
    expect(mine.comments.map(({ body }) => body)).toContainEqual(
      expect.stringMatching(/thank you/i),
    );
    expect(
      mine.comments.filter(({ body }) => /thank you/i.test(body) && body !== "This is lovely!"),
    ).toHaveLength(1);

    const folder = mkdtempSync(path.join(tmpdir(), "truman-bystander-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    const runs = parse(readFileSync(path.join(folder, "beat_runs.csv"), "utf8"), {
      columns: true,
    }) as Record<string, string>[];
    expect(runs.map(({ beat }) => beat)).toEqual(
      expect.arrayContaining(["maya-thanks", "sam-agrees", "jake-mocks"]),
    );
    expect(runs.find(({ beat }) => beat === "maya-thanks")).toMatchObject({
      status: "fired",
      actor: "maya",
    });
  });
});

/** A small study with only the beats a test needs. */
async function study(beats: string, features = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-beats-"));
  dirs.push(dir);
  const slug = `beats-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Beats
site: { name: Demo }
length: { days: 1 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }]
platform: { style: text, template: shortPosts${features} }
feed: { ranker: chronological }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name\nann,Ann\nbob,Bob\n",
    "posts.csv": "id,body,actor,time\np1,Hello from Ann,ann,-1:00\n",
    "beats.yaml": beats,
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  await importFolder(dir);
  return slug;
}

async function write(cookie: string, body: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...meta(), body })) {
    form.set(key, value);
  }
  const made = await app.request("/posts", { method: "POST", headers: { cookie }, body: form });
  return ((await made.json()) as { id: string }).id;
}

describe("Christof's rules", () => {
  it("reacts to their nth post, likes, follows, and reposts, and only those", async () => {
    const slug = await study(`
beats:
  - { id: second-post, when: { participant: post, nth: 1 }, do: { action: like, actor: ann, on: trigger } }
  - { id: liked-ann, when: { participant: like, on: ann }, do: { action: follow, actor: ann } }
  - { id: followed, when: { participant: follow }, do: { action: post, actor: bob, text: "Welcome aboard!" } }
  - { id: reposted, when: { participant: repost }, do: { action: comment, actor: bob, on: trigger, text: "Thanks for sharing" } }
`);
    const cookie = await join(slug);
    const first = await write(cookie, "One");
    const second = await write(cookie, "Two");
    const p1 = byBody(await feed(cookie), "Hello from Ann");
    await act(cookie, p1.id, "like", { active: true });
    await call(cookie, "POST", "/actors/bob/relation", { ...meta(), action: "follow" });
    await act(cookie, p1.id, "repost", { active: true });

    const posts = await feed(cookie);
    expect(byBody(posts, "Two").likes).toBe(1);
    expect(byBody(posts, "One").likes).toBe(0);
    expect(posts.some(({ body }) => body === "Welcome aboard!")).toBe(true);
    const { notifications } = (await (await call(cookie, "GET", "/notifications")).json()) as {
      notifications: { type: string }[];
    };
    expect(notifications.map(({ type }) => type)).toEqual(
      expect.arrayContaining(["follow", "like"]),
    );
    const runs = (await runsIn(cookie)).map(({ beat, status, targetContentId }) => [
      beat,
      status,
      targetContentId,
    ]);
    expect(runs).toEqual(
      expect.arrayContaining([
        ["second-post", "fired", second],
        ["liked-ann", "fired", null],
        ["followed", "fired", null],
        ["reposted", "fired", p1.id],
      ]),
    );
    expect(runs.find(([, , target]) => target === first)).toBeUndefined();
  });

  it("happens at most as often as allowed, and waits for its delay", async () => {
    const slug = await study(`
beats:
  - id: cheer
    when: { participant: post }
    max: 2
    delay: { min: "0:10", max: "0:20" }
    do: { action: like, actor: ann, on: trigger }
`);
    const cookie = await join(slug);
    for (const text of ["A", "B", "C"]) {
      await write(cookie, text);
    }
    expect((await feed(cookie)).filter(({ likes }) => likes > 0)).toEqual([]);
    const runs = await runsIn(cookie);
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      const delayMs = run.dueAt.getTime() - run.triggeredAt.getTime();
      expect(delayMs).toBeGreaterThanOrEqual(10 * 60_000);
      expect(delayMs).toBeLessThanOrEqual(20 * 60_000);
    }
    await advance(cookie, 25);
    const liked = (await feed(cookie)).filter(({ likes }) => likes > 0).map(({ body }) => body);
    expect(liked.sort()).toEqual(["A", "B"]);
  });

  it("is decided again if the server stopped partway through deciding it", async () => {
    const slug = await study(`
beats:
  - { id: later, when: { time: "0:10" }, do: { action: like, actor: bob, on: { post: p1 } } }
`);
    const cookie = await join(slug);
    await feed(cookie);
    await advance(cookie, 15);
    const { worldId } = await worldOf(cookie);
    // As if a request had claimed it, then the server stopped before recording what happened.
    const stuck = (minutesAgo: number) =>
      database.db
        .update(schema.beatRuns)
        .set({
          status: "skipped",
          reason: "being decided",
          decidedAt: new Date(Date.now() - minutesAgo * 60_000),
        })
        .where(eq(schema.beatRuns.worldId, worldId));
    await stuck(1);
    await feed(cookie);
    expect((await runsIn(cookie))[0]).toMatchObject({ status: "skipped", reason: "being decided" });

    const before = byBody(await feed(cookie), "Hello from Ann").likes;
    await stuck(11);
    expect(byBody(await feed(cookie), "Hello from Ann").likes).toBe(before + 1);
    expect((await runsIn(cookie))[0]).toMatchObject({ status: "fired" });
  });

  it("is skipped, with a reason, when what it needs is off", async () => {
    const slug = await study(
      `
beats:
  - { id: soon, when: { time: "0:00" }, do: { action: comment, actor: bob, on: { post: p1 }, text: "Hi" } }
`,
      ", features: { comments: false }",
    );
    const cookie = await join(slug);
    await feed(cookie);
    const [run] = await runsIn(cookie);
    expect(run).toMatchObject({ status: "skipped", reason: "comments is off in this condition" });
  });

  it("goes with a participant who withdraws", async () => {
    const slug = await study(`
beats:
  - { id: soon, when: { time: "0:00" }, do: { action: like, actor: bob, on: { post: p1 } } }
`);
    const externalId = randomUUID();
    const cookie = await join(slug, externalId);
    await feed(cookie);
    const { worldId } = await worldOf(cookie);
    expect(await runsIn(cookie)).toHaveLength(1);
    await withdrawParticipant(database.db, storage, {
      slug,
      externalId,
      reason: "test",
      requestedBy: "test",
    });
    const left = await database.db
      .select()
      .from(schema.beatRuns)
      .where(eq(schema.beatRuns.worldId, worldId));
    expect(left).toEqual([]);
  });
});
