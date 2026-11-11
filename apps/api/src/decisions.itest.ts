import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import type { FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder } from "@truman3/study-import";
import { parse } from "csv-parse/sync";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

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

/**
 * A study where everyone starts in "a". "b" and "c" have weight 0, so only a decision point puts
 * anyone there, and a beat posts a nudge in "b" right after the decision.
 */
async function study(decide: string, extraBeats = "", teamId?: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-decide-"));
  dirs.push(dir);
  const slug = `decide-${randomUUID().slice(0, 8)}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Adaptive
site: { name: Demo }
length: { days: 1 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }, { key: b, weight: 0 }, { key: c, weight: 0 }]
platform: { style: text, template: shortPosts }
feed: { ranker: chronological }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name\nann,Ann Lee\n",
    "posts.csv": "id,body,actor,time\np1,Hello from Ann,ann,-1:00\n",
    "beats.yaml": `
beats:
  - id: nudge
    when: { beat: day-1 }
    conditions: [b]
    do: { action: post, actor: ann, text: "Nudge for b" }
${extraBeats}
decide:
${decide}
`,
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, {
    launch: true,
    ...(teamId ? { teamId } : {}),
  });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  return slug;
}

const QUIET_TO_B = `
  - id: day-1
    when: { time: "0:10" }
    conditions: [a]
    measure:
      posts: { count: post }
    groups:
      - { name: quiet, if: { posts: { atMost: 0 } }, to: { b: 1 } }
      - { name: active, to: stay }
`;

async function join(slug: string) {
  const externalId = randomUUID();
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId }),
  });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const [row] = await database.db
    .select({ participantId: schema.participants.id, worldId: schema.worldMemberships.worldId })
    .from(schema.participants)
    .innerJoin(
      schema.worldMemberships,
      eq(schema.worldMemberships.participantId, schema.participants.id),
    )
    .where(eq(schema.participants.externalId, externalId));
  const { participantId, worldId } = row as { participantId: string; worldId: string };
  return {
    participantId,
    feed: async () =>
      (
        (await (await app.request("/feed", { headers: { cookie } })).json()) as FeedResponse
      ).posts.map(({ body }) => body),
    /** Posts, as of this many minutes ago, since the event log can't be moved later. */
    async write(body: string, minutesAgo = 0) {
      const form = new FormData();
      form.set("clientEventId", randomUUID());
      form.set("occurredAt", new Date(Date.now() - minutesAgo * 60_000).toISOString());
      form.set("body", body);
      await app.request("/posts", { method: "POST", headers: { cookie }, body: form });
    },
    /** Moves their world this many minutes into its future. */
    async advance(minutes: number) {
      const by = sql`interval '1 minute' * ${minutes}`;
      await database.db
        .update(schema.worlds)
        .set({ startedAt: sql`${schema.worlds.startedAt} - ${by}` })
        .where(eq(schema.worlds.id, worldId));
      await database.db
        .update(schema.beatRuns)
        .set({ dueAt: sql`${schema.beatRuns.dueAt} - ${by}` })
        .where(and(eq(schema.beatRuns.worldId, worldId), eq(schema.beatRuns.status, "pending")));
    },
    assignments: () =>
      database.db
        .select({
          condition: schema.conditions.key,
          decisionPoint: schema.assignments.decisionPoint,
          method: schema.assignments.method,
          probability: schema.assignments.probability,
          details: schema.assignments.details,
        })
        .from(schema.assignments)
        .innerJoin(schema.conditions, eq(schema.conditions.id, schema.assignments.conditionId))
        .where(eq(schema.assignments.participantId, participantId))
        .orderBy(asc(schema.assignments.id)),
    runs: () =>
      database.db
        .select({
          beat: schema.beatRuns.beat,
          status: schema.beatRuns.status,
          reason: schema.beatRuns.reason,
        })
        .from(schema.beatRuns)
        .where(eq(schema.beatRuns.worldId, worldId))
        .orderBy(asc(schema.beatRuns.dueAt)),
  };
}

describe("a decision point", () => {
  it("moves someone who hasn't posted, records why and with what chance, and what follows happens", async () => {
    const person = await join(await study(QUIET_TO_B));
    expect(await person.feed()).not.toContain("Nudge for b");
    await person.advance(11);
    expect(await person.feed()).toContain("Nudge for b");

    expect(await person.assignments()).toEqual([
      expect.objectContaining({ condition: "a", decisionPoint: null }),
      {
        condition: "b",
        decisionPoint: "day-1",
        method: "decision",
        probability: 1,
        details: { group: "quiet", from: "a", measures: { posts: 0 } },
      },
    ]);
    expect(await person.runs()).toEqual([
      {
        beat: "day-1",
        status: "fired",
        reason: 'In "quiet" (posts 0), moved from "a" to "b", with a chance of 100%.',
      },
      { beat: "nudge", status: "fired", reason: null },
    ]);
  });

  it("shows on the Monitor page, where people are counted where they started and where they are now", async () => {
    const id = randomUUID().slice(0, 8);
    const { teamId, password } = await setUpTeam(database.db, {
      teamName: `lab-${id}`,
      slug: `lab-${id}`,
      email: `${id}@example.edu`,
      name: "Owner",
    });
    const slug = await study(QUIET_TO_B, "", teamId);
    const moved = await join(slug);
    await join(slug);
    await moved.advance(11);
    await moved.feed();

    const login = await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${id}@example.edu`, password }),
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const [found] = await database.db
      .select({ id: schema.studies.id })
      .from(schema.studies)
      .where(eq(schema.studies.slug, slug));
    const monitor = (await (
      await app.request(`/admin/studies/${found?.id}/monitor`, { headers: { cookie } })
    ).json()) as {
      reRandomized: boolean;
      conditions: { key: string; enrolled: number; now: number }[];
    };
    expect(monitor.reRandomized).toBe(true);
    expect(monitor.conditions.map(({ key, enrolled, now }) => [key, enrolled, now])).toEqual([
      ["a", 2, 1],
      ["b", 0, 1],
      ["c", 0, 0],
    ]);
  });

  it("keeps someone who posted where they are, and records that too", async () => {
    const person = await join(await study(QUIET_TO_B));
    await person.advance(11);
    await person.write("Here I am", 5);
    expect(await person.feed()).not.toContain("Nudge for b");
    const [, second] = await person.assignments();
    expect(second).toMatchObject({
      condition: "a",
      decisionPoint: "day-1",
      probability: 1,
      details: { group: "active", measures: { posts: 1 } },
    });
  });

  it("re-randomizes by weight, and records the chance they had", async () => {
    const person = await join(
      await study(`
  - id: day-1
    when: { participant: post, nth: 0 }
    groups:
      - { name: everyone, to: { b: 1, c: 3 } }
`),
    );
    await person.write("First");
    await person.feed();
    const [, second] = await person.assignments();
    expect(["b", "c"]).toContain(second?.condition);
    expect(second?.probability).toBe(second?.condition === "b" ? 0.25 : 0.75);
  });

  it("happens once, and skips beats for the condition they left", async () => {
    const person = await join(
      await study(
        QUIET_TO_B,
        `
  - id: only-in-a
    when: { time: "0:20" }
    conditions: [a]
    do: { action: post, actor: ann, text: "Only in a" }
`,
      ),
    );
    await person.advance(11);
    await person.feed();
    // The beat was written down while they were in "a", and is due after they moved.
    await database.db.insert(schema.beatRuns).values({
      worldId: (await database.db
        .select({ worldId: schema.worldMemberships.worldId })
        .from(schema.worldMemberships)
        .where(eq(schema.worldMemberships.participantId, person.participantId))
        .then(([row]) => row?.worldId)) as string,
      beat: "only-in-a",
      run: 0,
      status: "pending",
      trigger: { kind: "time" },
      triggeredAt: new Date(),
      dueAt: new Date(),
    });
    await person.advance(15);
    expect(await person.feed()).not.toContain("Only in a");
    const runs = await person.runs();
    expect(runs.filter(({ beat }) => beat === "day-1")).toHaveLength(1);
    expect(runs.find(({ beat }) => beat === "only-in-a")).toMatchObject({
      status: "skipped",
      reason: 'it isn\'t in "b", their condition now',
    });
    expect(await person.assignments()).toHaveLength(2);
  });

  it("is in the export, with every assignment in order", async () => {
    const slug = await study(QUIET_TO_B);
    const person = await join(slug);
    await person.advance(11);
    await person.feed();
    const folder = mkdtempSync(path.join(tmpdir(), "truman-decide-export-"));
    dirs.push(folder);
    await exportStudy(database.db, slug, folder);
    const rows = parse(readFileSync(path.join(folder, "assignments.csv"), "utf8"), {
      columns: true,
    }) as Record<string, string>[];
    expect(rows).toEqual([
      expect.objectContaining({ stage: "0", decision_point: "", condition: "a" }),
      expect.objectContaining({
        stage: "1",
        decision_point: "day-1",
        condition: "b",
        method: "decision",
        probability: "1",
        group: "quiet",
        measures: '{"posts":0}',
      }),
    ]);
    const participants = parse(readFileSync(path.join(folder, "participants.csv"), "utf8"), {
      columns: true,
    }) as Record<string, string>[];
    expect(participants[0]?.condition).toBe("b");
  });
});
