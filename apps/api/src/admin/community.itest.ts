import { randomUUID } from "node:crypto";
import path from "node:path";
import { addResearcherToTeam, setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { type CommunityRequest, standInWriter, type Writer } from "@truman3/writer";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

// Drafting a community ahead, for a researcher to review (ADR 99).

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
let appWithoutModel: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const STUDY = path.resolve(import.meta.dirname, "../../../../studies/examples/vaccine-frames");
const asked: CommunityRequest[] = [];

/** The stand-in, except that one reply on the second day says something the check refuses. */
const writer: Writer = {
  ...standInWriter(),
  async community(request) {
    asked.push(request);
    const day = await standInWriter().community(request);
    if (request.prompt.startsWith("Day 2")) {
      const [first] = day.posts;
      first?.replies.push({
        actor: request.cast[0] as string,
        body: "unsafe",
        minutesAfter: 5,
        replyTo: null,
      });
    }
    return day;
  },
};

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
  const base = {
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => undefined,
    secureCookies: false,
  };
  app = createApp({ ...base, writer });
  appWithoutModel = createApp(base);
});

afterAll(async () => {
  storage.close();
  await database.destroy();
});

async function signIn(email: string, password: string) {
  const login = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

/** A lab with a two-condition study, and a draft of it. */
async function draft() {
  const id = randomUUID().slice(0, 8);
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email: `${id}@example.edu`,
    name: "Owner",
  });
  const imported = await importStudyFolder(database.db, storage, STUDY, {
    teamId,
    change: (study) => ({ ...study, settings: { ...study.settings, slug: `frames-${id}` } }),
  });
  if (imported.status === "failed") {
    throw new Error("import");
  }
  const cookie = await signIn(`${id}@example.edu`, password as string);
  const opened = await app.request(`/admin/versions/${imported.studyVersionId}/draft`, {
    method: "POST",
    headers: { cookie },
  });
  const { draftId } = (await opened.json()) as { draftId: string };
  return { id, cookie, draftId };
}

const call = (target: typeof app, cookie: string, method: string, url: string, body?: object) =>
  target.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const ask = {
  about: "Neighbors in a small town, swapping news, recipes, and complaints about the roads.",
  topics: ["the farmers market", "road work"],
  postsPerDay: 2,
  repliesPerPost: 2,
  daysBefore: 1,
  daysDuring: 2,
  neverSay: ["Anything about the election"],
  conditions: { mode: "same" },
};

/** Waits for the latest run to finish. */
async function finished(cookie: string, draftId: string) {
  for (let tries = 0; tries < 50; tries++) {
    const { run } = (await (
      await call(app, cookie, "GET", `/admin/drafts/${draftId}/community`)
    ).json()) as {
      run: { id: string; status: string; progress: Record<string, number>; costUsd: number };
    };
    if (run.status !== "running") {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("It never finished.");
}

const generated = async (draftId: string) =>
  (
    await database.db
      .select()
      .from(schema.draftItems)
      .where(and(eq(schema.draftItems.draftId, draftId), isNull(schema.draftItems.deletedAt)))
  ).filter(({ provenance }) => (provenance as { origin: string }).origin === "generated");

describe("drafting a community", () => {
  it("writes each day as posts and replies by the cast, marked as generated, and leaves out what fails the check", async () => {
    const { cookie, draftId } = await draft();
    const started = await call(app, cookie, "POST", `/admin/drafts/${draftId}/community`, ask);
    expect(started.status).toBe(202);
    const run = await finished(cookie, draftId);
    expect(run).toMatchObject({
      status: "done",
      progress: { days: 3, of: 3, posts: 6, replies: 6, dropped: 1 },
    });
    expect(run.costUsd).toBeGreaterThan(0);

    const items = await generated(draftId);
    const posts = items.filter(({ kind }) => kind === "post");
    expect(posts).toHaveLength(6);
    expect(items.filter(({ kind }) => kind === "comment")).toHaveLength(6);
    // The day before they arrive is before the start, and the rest after.
    const times = posts
      .map(({ data }) => (data as { timeMs: number }).timeMs)
      .sort((a, b) => a - b);
    expect(times[0]).toBeLessThan(0);
    expect(times.at(-1)).toBeGreaterThan(0);
    expect((posts[0]?.provenance as { detail: object } | undefined)?.detail).toMatchObject({
      by: "community",
      run: expect.any(String),
    });
    expect(JSON.stringify(items)).not.toContain('"unsafe"');

    // What was asked: the community, the cast, the red lines, and what came before.
    expect(asked.at(-1)?.system).toContain("Neighbors in a small town");
    expect(asked.at(-1)?.system).toContain("Anything about the election");
    expect(asked.at(-1)?.prompt).toContain("What's been posted so far");
  });

  it("can write a different community for each condition", async () => {
    const { cookie, draftId } = await draft();
    await call(app, cookie, "POST", `/admin/drafts/${draftId}/community`, {
      ...ask,
      daysBefore: 0,
      daysDuring: 1,
      conditions: {
        mode: "each",
        about: { low: "People are friendly.", high: "People argue." },
      },
    });
    const run = await finished(cookie, draftId);
    expect(run.status).toBe("done");
    const conditions = (await generated(draftId))
      .filter(({ kind }) => kind === "post")
      .map(({ data }) => (data as { conditions: string[] }).conditions);
    expect(conditions).toHaveLength(6);
    expect(new Set(conditions.map((keys) => keys.join()))).toEqual(
      new Set(["low", "medium", "high"]),
    );
  });

  it("takes everything a run wrote back out, and nothing else", async () => {
    const { cookie, draftId } = await draft();
    const before = (
      await database.db
        .select()
        .from(schema.draftItems)
        .where(and(eq(schema.draftItems.draftId, draftId), isNull(schema.draftItems.deletedAt)))
    ).length;
    await call(app, cookie, "POST", `/admin/drafts/${draftId}/community`, {
      ...ask,
      daysBefore: 0,
    });
    const run = await finished(cookie, draftId);
    const removed = await call(
      app,
      cookie,
      "DELETE",
      `/admin/drafts/${draftId}/community/${run.id}`,
    );
    expect(removed.status).toBe(200);
    expect(await generated(draftId)).toEqual([]);
    const after = (
      await database.db
        .select()
        .from(schema.draftItems)
        .where(and(eq(schema.draftItems.draftId, draftId), isNull(schema.draftItems.deletedAt)))
    ).length;
    expect(after).toBe(before);
  });

  it("isn't for viewers, someone signed out, or a server with no model", async () => {
    const { id, cookie, draftId } = await draft();
    const email = `viewer-${id}@example.edu`;
    const added = await addResearcherToTeam(database.db, {
      teamSlug: `lab-${id}`,
      email,
      name: "Viewer",
      role: "viewer",
    });
    const viewer = await signIn(email, added.password as string);
    expect(
      (await call(app, viewer, "POST", `/admin/drafts/${draftId}/community`, ask)).status,
    ).toBe(403);
    expect((await call(app, "", "POST", `/admin/drafts/${draftId}/community`, ask)).status).toBe(
      401,
    );
    expect(
      (await call(appWithoutModel, cookie, "POST", `/admin/drafts/${draftId}/community`, ask))
        .status,
    ).toBe(409);
    expect(
      (
        await call(app, cookie, "POST", `/admin/drafts/${draftId}/community`, {
          ...ask,
          daysBefore: 0,
          daysDuring: 0,
        })
      ).status,
    ).toBe(400);
  });
});

describe("persona cards, as a form", () => {
  it("are saved into beats.yaml for someone in the cast, and read back", async () => {
    const { id, cookie, draftId } = await draft();
    const cards = async () =>
      (await (await call(app, cookie, "GET", `/admin/drafts/${draftId}/persona-cards`)).json()) as {
        cards: Record<string, { voice?: string; relationships?: Record<string, string> }>;
        problem: string | null;
      };
    const [someone, another] = (
      await database.db
        .select({ data: schema.draftItems.data })
        .from(schema.draftItems)
        .where(and(eq(schema.draftItems.draftId, draftId), eq(schema.draftItems.kind, "actor")))
    ).map(({ data }) => (data as { username: string }).username) as [string, string];
    const save = (who: string, username: string, card: object) =>
      call(app, who, "PUT", `/admin/drafts/${draftId}/persona-cards/${username}`, card);
    const card = {
      voice: "Short and dry.",
      relationships: { [another]: "Old friends", participant: "Curious about them" },
      redLines: ["Never gives medical advice"],
    };
    expect((await save(cookie, someone, card)).status).toBe(200);
    expect((await cards()).cards[someone]).toMatchObject({
      voice: "Short and dry.",
      relationships: { [another]: "Old friends", participant: "Curious about them" },
    });
    expect((await cards()).problem).toBeNull();
    // The model writing a community is told.
    await call(app, cookie, "POST", `/admin/drafts/${draftId}/community`, {
      ...ask,
      daysBefore: 0,
      daysDuring: 1,
    });
    await finished(cookie, draftId);
    expect(asked.at(-1)?.system).toContain("How they write: Short and dry.");

    // Emptied, it's gone. Nobody outside the cast has one, or is felt about.
    expect((await save(cookie, someone, { redLines: [] })).status).toBe(200);
    expect((await cards()).cards[someone]).toBeUndefined();
    expect((await save(cookie, "nobody-here", card)).status).toBe(404);
    expect(
      (await save(cookie, someone, { relationships: { stranger: "?" }, redLines: [] })).status,
    ).toBe(400);
    expect((await save("", someone, card)).status).toBe(401);
    const email = `cards-${id}@example.edu`;
    const added = await addResearcherToTeam(database.db, {
      teamSlug: `lab-${id}`,
      email,
      name: "Viewer",
      role: "viewer",
    });
    const viewer = await signIn(email, added.password as string);
    expect((await save(viewer, someone, card)).status).toBe(403);
  });
});
