import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import type { FeedPost, FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { standInWriter, type WriteRequest } from "@truman3/writer";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { Writing } from "./director/wording.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

/** What the stand-in model writes, which a test can change. */
let nextLine = (request: WriteRequest) => `Live line about: ${request.prompt.slice(-40)}`;
const writer = standInWriter((request) => nextLine(request));

let app: ReturnType<typeof createApp>;
let appWithoutModel: ReturnType<typeof createApp>;

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
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  storage.close();
  await database.destroy();
});

const meta = () => ({ clientEventId: randomUUID(), occurredAt: new Date().toISOString() });

/** A study whose one beat improvises a reply to the participant's first post, at once. */
async function study(live: string, teamId?: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-live-"));
  dirs.push(dir);
  const slug = `live-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Live
site: { name: Demo }
length: { days: 1 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }]
platform: { style: text, template: shortPosts }
feed: { ranker: chronological }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name\nann,Ann Lee\n",
    "posts.csv": "id,body,actor,time\np1,Hello from Ann,ann,-1:00\n",
    "beats.yaml": `
${live}
cast:
  ann:
    voice: Warm, short sentences, lots of exclamation marks
    redLines: [Never mention politics]
beats:
  - id: welcome
    when: { participant: post, nth: 0 }
    max: 3
    do:
      action: comment
      actor: ann
      on: trigger
      improvise: Welcome them warmly and ask about their post
      fallback: Welcome! Great to have you here.
  - id: again
    when: { participant: post, nth: 1 }
    do:
      action: comment
      actor: ann
      on: trigger
      improvise: Say something nice about their second post
      fallback: Love this one too!
`,
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, { launch: true, teamId });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  return slug;
}

const LIVE_ON = "live: { enabled: true, budgetUsd: 1 }";

function participant(on: ReturnType<typeof createApp>, slug: string) {
  let cookie = "";
  const call = (method: string, url: string, body?: object) =>
    on.request(url, {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return {
    async join() {
      const response = await on.request(`/studies/${slug}/enter`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ externalId: randomUUID() }),
      });
      cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    },
    async write(body: string) {
      const form = new FormData();
      for (const [key, value] of Object.entries({ ...meta(), body })) {
        form.set(key, value);
      }
      const made = await on.request("/posts", { method: "POST", headers: { cookie }, body: form });
      return ((await made.json()) as { id: string }).id;
    },
    feed: async () => ((await (await call("GET", "/feed")).json()) as FeedResponse).posts,
    /** What the app checks in the background, which is where lines get written. */
    poll: () => call("GET", "/me"),
    post: async (id: string) =>
      ((await (await call("GET", `/feed?surface=post&post=${id}`)).json()) as FeedResponse)
        .posts[0] as FeedPost,
  };
}

const runOf = async (beat: string) => {
  const [run] = await database.db
    .select()
    .from(schema.beatRuns)
    .where(eq(schema.beatRuns.beat, beat))
    .orderBy(schema.beatRuns.dueAt);
  return run;
};
const latestRun = async (beat: string) => {
  const runs = await database.db
    .select()
    .from(schema.beatRuns)
    .where(eq(schema.beatRuns.beat, beat));
  return runs.sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime())[0];
};

/** How the latest run of a beat chose its words. */
const writingOf = async (beat: string) => ((await latestRun(beat))?.writing ?? {}) as Writing;
const firstWritingOf = async (beat: string) => ((await runOf(beat))?.writing ?? {}) as Writing;

describe("an improvised beat", () => {
  it("uses its fallback line when live writing is off, and says why", async () => {
    const person = participant(app, await study(""));
    await person.join();
    const id = await person.write("My first post");
    await person.poll();
    expect((await person.post(id)).comments.map(({ body }) => body)).toEqual([
      "Welcome! Great to have you here.",
    ]);
    expect((await latestRun("welcome"))?.writing).toEqual({
      mode: "fallback",
      reason: "live writing is off for this study",
      costUsd: 0,
    });
  });

  it("uses its fallback line on a server with no model", async () => {
    const person = participant(appWithoutModel, await study(LIVE_ON));
    await person.join();
    const id = await person.write("My first post");
    await person.poll();
    expect((await person.post(id)).comments[0]?.body).toBe("Welcome! Great to have you here.");
    expect((await writingOf("welcome")).reason).toBe("this server has no model set up");
  });

  it("is written live in the background, never while a page loads, with what was asked recorded", async () => {
    nextLine = () => "Welcome!! What made you post that?";
    const person = participant(app, await study(LIVE_ON));
    await person.join();
    const id = await person.write("Trying out this new place");
    const calls = writer.calls.length;

    // Loading the post doesn't wait for a model, so the reply isn't there yet.
    expect((await person.post(id)).comments).toEqual([]);
    expect(writer.calls.length).toBe(calls);

    await person.poll();
    expect((await person.post(id)).comments.map(({ body }) => body)).toEqual([
      "Welcome!! What made you post that?",
    ]);
    const request = writer.calls.at(-1) as WriteRequest;
    expect(request.model).toBe("claude-opus-5-5");
    expect(request.system).toContain("You are Ann Lee (@ann).");
    expect(request.system).toContain("Warm, short sentences");
    expect(request.system).toContain("Never mention politics");
    expect(request.system).toContain("Slurs");
    expect(request.prompt).toContain("Trying out this new place");
    expect(request.prompt).toContain("Welcome them warmly and ask about their post");

    const writing = (await latestRun("welcome"))?.writing as Writing;
    expect(writing).toMatchObject({
      mode: "live",
      model: "stand-in",
      output: "Welcome!! What made you post that?",
      check: { allowed: true },
      costUsd: 0.01,
    });
    expect(writing.prompt?.user).toContain("Trying out this new place");
  });

  it("uses the fallback line when the check stops what was written, and keeps both", async () => {
    nextLine = () => "BLOCK this";
    const person = participant(app, await study(LIVE_ON));
    await person.join();
    const id = await person.write("Hello");
    await person.poll();
    expect((await person.post(id)).comments[0]?.body).toBe("Welcome! Great to have you here.");
    expect((await latestRun("welcome"))?.writing).toMatchObject({
      mode: "fallback",
      reason: "the check stopped it: It crosses a limit.",
      output: "BLOCK this",
      check: { allowed: false },
    });
  });

  it("stops writing live once the study's budget is used up", async () => {
    nextLine = () => "A live line";
    const slug = await study("live: { enabled: true, budgetUsd: 0.01 }");
    const first = participant(app, slug);
    await first.join();
    await first.write("One");
    await first.poll();
    expect((await writingOf("welcome")).mode).toBe("live");

    const second = participant(app, slug);
    await second.join();
    const id = await second.write("Two");
    await second.poll();
    expect((await second.post(id)).comments[0]?.body).toBe("Welcome! Great to have you here.");
    expect((await writingOf("welcome")).reason).toBe("the study's budget of $0.01 is used up");
  });
});

describe("Christof's controls", () => {
  async function researcher() {
    const id = randomUUID().slice(0, 8);
    const { teamId, password } = await setUpTeam(database.db, {
      teamName: `lab-${id}`,
      slug: `lab-${id}`,
      email: `${id}@example.edu`,
      name: "Owner",
    });
    const login = await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${id}@example.edu`, password }),
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const call = (method: string, url: string, body?: object) =>
      app.request(url, {
        method,
        headers: { "content-type": "application/json", cookie },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    return { teamId, call };
  }

  it("pauses live writing for the study, or one person, and shows spending and decisions", async () => {
    nextLine = () => "Live hello";
    const lab = await researcher();
    const slug = await study(LIVE_ON, lab.teamId);
    const [found] = await database.db
      .select({ id: schema.studies.id })
      .from(schema.studies)
      .where(eq(schema.studies.slug, slug));
    const url = `/admin/studies/${found?.id}/christof`;

    const person = participant(app, slug);
    await person.join();
    await person.write("First");
    await person.poll();

    let state = (await (await lab.call("GET", url)).json()) as {
      spentUsd: number;
      improvisers: string[];
      runs: { beat: string; mode: string; output: string }[];
      hasModel: boolean;
    };
    expect(state).toMatchObject({ hasModel: true, spentUsd: 0.01, improvisers: ["ann"] });
    expect(state.runs[0]).toMatchObject({ beat: "welcome", mode: "live", output: "Live hello" });

    expect((await lab.call("PUT", url, { livePaused: false, pausedActors: ["ann"] })).status).toBe(
      200,
    );
    const id = await person.write("Second");
    await person.poll();
    expect((await person.post(id)).comments[0]?.body).toBe("Love this one too!");
    expect((await firstWritingOf("again")).reason).toBe("live writing is paused for ann");

    await lab.call("PUT", url, { livePaused: true, pausedActors: [] });
    const other = participant(app, slug);
    await other.join();
    await other.write("Hi");
    await other.poll();
    const runs = await database.db
      .select({ writing: schema.beatRuns.writing })
      .from(schema.beatRuns)
      .where(and(eq(schema.beatRuns.beat, "welcome")));
    expect(runs.map(({ writing }) => (writing as Writing).reason)).toContain(
      "live writing is paused for this study",
    );
    state = (await (await lab.call("GET", url)).json()) as typeof state;
    expect(state.spentUsd).toBe(0.01);
  });
});
