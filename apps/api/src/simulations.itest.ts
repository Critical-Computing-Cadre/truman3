import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder } from "@truman3/study-import";
import { standInWriter } from "@truman3/writer";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { findings, simulate } from "./scenarios/simulate.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const storage = createStorage(storageConfigFromEnv());
const BYSTANDER = path.resolve(import.meta.dirname, "../../../studies/examples/bystander");
const dirs: string[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
});

afterAll(async () => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  storage.close();
  await database.destroy();
});

/** The bystander example, under a new address, for a new team. */
async function importBystander() {
  const id = randomUUID().slice(0, 8);
  const dir = mkdtempSync(path.join(tmpdir(), "truman-simulate-"));
  dirs.push(dir);
  cpSync(BYSTANDER, dir, { recursive: true });
  const studyYaml = path.join(dir, "study.yaml");
  writeFileSync(
    studyYaml,
    readFileSync(studyYaml, "utf8").replace(/^slug: .*$/m, `slug: simulated-${id}`),
  );
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email: `${id}@example.edu`,
    name: "Tester",
  });
  const imported = await importStudyFolder(database.db, storage, dir, { teamId });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map(({ message }) => message).join("\n"));
  }
  return {
    versionId: imported.studyVersionId,
    email: `${id}@example.edu`,
    password: password as string,
    slug: `simulated-${id}`,
  };
}

describe("simulated participants", () => {
  it("go through the bystander study, and the report shows what happened in each condition", async () => {
    const { versionId } = await importBystander();
    const report = await simulate({
      db: database.db,
      storage,
      versionId,
      settings: { participants: 12, seed: 7 },
    });
    expect(report.participants).toBe(12);
    expect(report.conditions).toEqual({ defended: 6, silent: 6 });
    const beat = (id: string) => report.beats.find((item) => item.id === id);

    // Jake mocks Maya a few minutes in, for everyone, once.
    expect(beat("jake-mocks")?.happenedFor).toEqual({ defended: 6, silent: 6 });
    expect(beat("jake-mocks")?.mostForOne).toBe(1);
    // Each condition's beats stay in it.
    expect(beat("leo-likes-mocking")?.happenedFor.defended).toBe(0);
    expect(beat("sam-defends")?.happenedFor.silent).toBe(0);
    expect(findings(report).filter((note) => note.includes("which it isn't in"))).toEqual([]);
    // They did things, and nothing the API did failed.
    expect(Object.values(report.actions).reduce((sum, { done }) => sum + done, 0)).toBeGreaterThan(
      0,
    );
    expect(report.problems).toEqual([]);
  });

  it("repeats exactly with the same seed, and cleans up after itself", async () => {
    const { versionId } = await importBystander();
    const run = () =>
      simulate({
        db: database.db,
        storage,
        versionId,
        settings: { participants: 4, seed: 99 },
        cleanUp: true,
      });
    // What they did is deleted, as with scenario tests. Only a record of each deletion stays.
    const events = async () =>
      (
        await database.db
          .select({ id: schema.events.id })
          .from(schema.events)
          .where(eq(schema.events.studyVersionId, versionId))
      ).length;
    const first = await run();
    expect(await run()).toEqual(first);
    expect(await events()).toBe(0);
  });

  it("names a beat that never happens", async () => {
    const { versionId } = await importBystander();
    const report = await simulate({
      db: database.db,
      storage,
      versionId,
      settings: { participants: 2, seed: 1 },
      // Participants who never do anything never set off what answers them.
      behaviorFor: () => ({ next: () => null }),
    });
    expect(findings(report)).toContain(
      `"jake-answers-participant" never happened, for any of the 2 who could have had it.`,
    );
  });

  it("run from the admin app, in the background, for editors", async () => {
    const { versionId, email, password } = await importBystander();
    const app = createApp({
      pingDatabase: database.ping,
      db: database.db,
      storage,
      mediaPublicUrl: "http://media.test",
      getClientIp: () => undefined,
      secureCookies: false,
    });
    const login = await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const call = (method: string, body?: object) =>
      app.request(`/admin/versions/${versionId}/simulations`, {
        method,
        headers: { "content-type": "application/json", cookie },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

    expect(await (await call("GET")).json()).toEqual({
      title: "Bystander (reference study)",
      version: 1,
      canRun: true,
      latest: null,
      most: 200,
      studyId: expect.any(String),
      personas: [
        expect.objectContaining({ id: "quiet-bystander" }),
        expect.objectContaining({ id: "upstander" }),
      ],
      model: "claude-sonnet-5-5",
      // This app has no model, so personas can't be played.
      canPlay: false,
      noModel: "This server has no Claude key.",
      synthetic: 0,
    });
    const refused = await call("POST", { personas: ["upstander"] });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({
      error: "This server has no Claude key.",
    });
    expect((await call("POST", { personas: ["nobody"] })).status).toBe(400);
    expect((await call("POST", { participants: 500 })).status).toBe(400);
    const started = await call("POST", { participants: 3, seed: 5 });
    expect(started.status).toBe(202);
    expect((await call("POST", { participants: 3 })).status).toBe(409);

    let latest: { status: string; report: { participants: number } | null; findings: string[] };
    for (let tries = 0; ; tries++) {
      latest = ((await (await call("GET")).json()) as { latest: typeof latest }).latest;
      if (latest.status !== "running" || tries > 200) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(latest).toMatchObject({
      status: "done",
      settings: { participants: 3, seed: 5 },
      report: { participants: 3 },
      startedBy: "Tester",
    });
  });
});

describe("personas and synthetic data", () => {
  it("a model plays each persona, and the report has what each saw and did", async () => {
    const { versionId } = await importBystander();
    const report = await simulate({
      db: database.db,
      storage,
      versionId,
      settings: {
        participants: 2,
        seed: 1,
        personas: ["quiet-bystander", "upstander"],
        budgetUsd: 5,
      },
      writer: standInWriter(),
      cleanUp: true,
    });
    expect(report.participants).toBe(2);
    expect(report.transcripts.map(({ persona, condition }) => [persona, condition])).toEqual([
      ["quiet-bystander", "defended"],
      // A persona can say which condition it starts in.
      ["upstander", "silent"],
    ]);
    // The stand-in comments on the first thing it sees, then does nothing.
    for (const transcript of report.transcripts) {
      expect(transcript.entries[0]?.did).toMatch(/^Commented "A stand-in comment" on: /);
      expect(transcript.entries.slice(1).every(({ did }) => did === null)).toBe(true);
    }
    const looks = report.transcripts.reduce((sum, { entries }) => sum + entries.length, 0);
    expect(report.costUsd).toBeCloseTo(looks * 0.01);
    expect(report.stopped).toBeNull();
  });

  it("stops at its budget, and says so", async () => {
    const { versionId } = await importBystander();
    const report = await simulate({
      db: database.db,
      storage,
      versionId,
      settings: {
        participants: 2,
        seed: 1,
        personas: ["quiet-bystander", "upstander"],
        budgetUsd: 0.02,
      },
      writer: standInWriter(),
      cleanUp: true,
    });
    expect(report.transcripts).toHaveLength(1);
    expect(report.transcripts[0]?.entries).toHaveLength(2);
    expect(report.stopped).toBe("It reached its $0.02 budget during participant 1 of 2.");
    expect(findings(report)).toContain(report.stopped);
  });

  it("keeps them as synthetic data, in the past, and only in the synthetic download", async () => {
    const { versionId, slug } = await importBystander();
    await simulate({
      db: database.db,
      storage,
      versionId,
      settings: { participants: 3, seed: 4, keep: true },
      cleanUp: true,
    });
    const kept = await database.db
      .select()
      .from(schema.participants)
      .innerJoin(
        schema.studyVersions,
        eq(schema.studyVersions.studyId, schema.participants.studyId),
      )
      .where(and(eq(schema.studyVersions.id, versionId), eq(schema.participants.synthetic, true)));
    expect(kept).toHaveLength(3);
    expect(kept.every(({ participants }) => participants.isPilot)).toBe(true);
    // Their worlds ran through the study's day and ended by now.
    const events = await database.db
      .select({ at: schema.events.occurredAt })
      .from(schema.events)
      .where(eq(schema.events.studyVersionId, versionId));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every(({ at }) => at.getTime() <= Date.now())).toBe(true);

    const folder = mkdtempSync(path.join(tmpdir(), "truman-synthetic-"));
    dirs.push(folder);
    const real = await exportStudy(database.db, slug, path.join(folder, "real"));
    const synthetic = await exportStudy(database.db, slug, path.join(folder, "synthetic"), {
      synthetic: true,
    });
    expect(real).toMatchObject({ status: "exported", participants: 0, events: 0 });
    expect(synthetic).toMatchObject({ status: "exported", participants: 3 });
    expect(readFileSync(path.join(folder, "synthetic", "codebook.md"), "utf8")).toContain(
      "**This is synthetic data.** Nobody real took part.",
    );

    // A synthetic participant is always a test participant, in the database too.
    await expect(
      database.db
        .update(schema.participants)
        .set({ isPilot: false })
        .where(eq(schema.participants.id, kept[0]?.participants.id as string)),
    ).rejects.toThrow();
  });
});
