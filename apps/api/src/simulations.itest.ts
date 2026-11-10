import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { eq } from "drizzle-orm";
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
    });
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
