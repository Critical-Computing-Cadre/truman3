import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addResearcherToTeam, setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { openDraft } from "@truman3/drafts";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];
const BYSTANDER = path.resolve(import.meta.dirname, "../../../studies/examples/bystander");

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

const signIn = async (email: string, password: string) => {
  const login = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return (method: string, url: string, body?: object) =>
    app.request(url, {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
};

/** The bystander example for a new team: an owner, an editor, and its study's id and slug. */
async function setUp() {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-archive-"));
  dirs.push(dir);
  cpSync(BYSTANDER, dir, { recursive: true });
  const slug = `gone-${randomUUID().slice(0, 8)}`;
  const studyYaml = path.join(dir, "study.yaml");
  writeFileSync(studyYaml, readFileSync(studyYaml, "utf8").replace(/^slug: .*$/m, `slug: ${slug}`));
  const id = randomUUID().slice(0, 8);
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email: `${id}@example.edu`,
    name: "Owner",
  });
  const editor = await addResearcherToTeam(database.db, {
    teamSlug: `lab-${id}`,
    email: `editor-${id}@example.edu`,
    name: "Editor",
    role: "editor",
  });
  const imported = await importStudyFolder(database.db, storage, dir, { teamId, launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map(({ message }) => message).join("\n"));
  }
  const [study] = await database.db
    .select({ id: schema.studies.id })
    .from(schema.studies)
    .where(eq(schema.studies.slug, slug));
  return {
    owner: await signIn(`${id}@example.edu`, password as string),
    editor: await signIn(`editor-${id}@example.edu`, editor.password as string),
    studyId: study?.id as string,
    versionId: imported.studyVersionId,
    slug,
  };
}

const listed = async (call: Awaited<ReturnType<typeof signIn>>, archived = false) =>
  (await (await call("GET", `/admin/studies${archived ? "?archived=true" : ""}`)).json()) as {
    archivedCount: number;
    studies: { id: string; archived: boolean; notDeletable: string | null }[];
  };

describe("archiving and deleting a study", () => {
  it("hides it from the list until it's restored, but not while it's open", async () => {
    const { editor, studyId } = await setUp();
    const open = await editor("PUT", `/admin/studies/${studyId}/archived`, { archived: true });
    expect(open.status).toBe(409);
    await editor("POST", `/admin/studies/${studyId}/stop`);
    await editor("PUT", `/admin/studies/${studyId}/archived`, { archived: true });
    const studies = await listed(editor);
    expect(studies.studies.map(({ id }) => id)).not.toContain(studyId);
    expect(studies.archivedCount).toBe(1);
    expect((await listed(editor, true)).studies).toEqual([
      expect.objectContaining({ id: studyId, archived: true, notDeletable: null }),
    ]);
    await editor("PUT", `/admin/studies/${studyId}/archived`, { archived: false });
    expect((await listed(editor)).studies.map(({ id }) => id)).toContain(studyId);
  });

  it("deletes a study only test participants took part in, and everything with it", async () => {
    const { owner, editor, studyId, versionId, slug } = await setUp();
    // Test participants, a scenario run, a draft, and a launch are all things it has.
    const pilot = await owner("POST", `/admin/versions/${versionId}/pilot`, {
      condition: "silent",
    });
    expect(pilot.status).toBe(200);
    await owner("POST", `/admin/versions/${versionId}/scenarios`);
    for (let tries = 0; tries < 100; tries++) {
      const [run] = await database.db
        .select({ status: schema.scenarioRuns.status })
        .from(schema.scenarioRuns)
        .where(eq(schema.scenarioRuns.studyVersionId, versionId));
      if (run && run.status !== "running") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const [researcher] = await database.db
      .select({ id: schema.researchers.id })
      .from(schema.researchers);
    await openDraft(database.db, versionId, researcher?.id as string);
    await owner("POST", `/admin/studies/${studyId}/stop`);

    // It has to be archived, confirmed, and done by an owner.
    expect((await owner("DELETE", `/admin/studies/${studyId}?confirm=${slug}`)).status).toBe(409);
    await owner("PUT", `/admin/studies/${studyId}/archived`, { archived: true });
    expect((await owner("DELETE", `/admin/studies/${studyId}?confirm=nope`)).status).toBe(400);
    expect((await editor("DELETE", `/admin/studies/${studyId}?confirm=${slug}`)).status).toBe(403);
    const deleted = await owner("DELETE", `/admin/studies/${studyId}?confirm=${slug}`);
    expect(await deleted.json()).toEqual({ deleted: true });

    const left = async (table: string) =>
      Number(
        (
          await database.ownerDb.execute<{ n: string }>(
            sql.raw(`select count(*) as n from ${table} where study_version_id = '${versionId}'`),
          )
        )[0]?.n,
      );
    for (const table of ["events", "worlds", "content", "actors", "conditions", "scenario_runs"]) {
      expect(await left(table), table).toBe(0);
    }
    const [study] = await database.db
      .select()
      .from(schema.studies)
      .where(eq(schema.studies.id, studyId));
    expect(study).toBeUndefined();
    const [record] = await database.db
      .select()
      .from(schema.studyDeletions)
      .where(eq(schema.studyDeletions.studyId, studyId));
    expect(record).toMatchObject({
      slug,
      title: "Bystander (reference study)",
      requestedBy: "Owner",
    });
  });

  it("refuses a study real people took part in, which can stay archived", async () => {
    const { owner, studyId, slug } = await setUp();
    await app.request(`/studies/${slug}/enter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId: randomUUID() }),
    });
    await owner("POST", `/admin/studies/${studyId}/stop`);
    await owner("PUT", `/admin/studies/${studyId}/archived`, { archived: true });
    expect((await listed(owner, true)).studies[0]?.notDeletable).toMatch(/Real people took part/);
    const refused = await owner("DELETE", `/admin/studies/${studyId}?confirm=${slug}`);
    expect(refused.status).toBe(409);
    // The database refuses too, even if asked directly.
    await expect(
      database.db.execute(sql`select delete_study(${studyId}, 'someone')`),
    ).rejects.toThrow();
  });

  it("can't be done by the API's login another way, past the rules", async () => {
    const { versionId } = await setUp();
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('truman.allow_study_deletion', 'on', true)`);
        await tx.execute(sql`delete from conditions where study_version_id = ${versionId}`);
      }),
    ).rejects.toThrow();
  });
});
