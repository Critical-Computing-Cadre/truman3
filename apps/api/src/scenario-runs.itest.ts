import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { openDraft, saveSection } from "@truman3/drafts";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { desc, eq } from "drizzle-orm";
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

interface Tests {
  scenarios: number;
  latest: { status: string; results: { name: string; passed: boolean }[]; startedBy: string };
}

/** The bystander example, imported for a new team with a signed-in researcher. */
async function setUp(scenarios?: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-runs-"));
  dirs.push(dir);
  cpSync(BYSTANDER, dir, { recursive: true });
  const slug = `runs-${randomUUID().slice(0, 8)}`;
  const studyYaml = path.join(dir, "study.yaml");
  writeFileSync(studyYaml, readFileSync(studyYaml, "utf8").replace(/^slug: .*$/m, `slug: ${slug}`));
  if (scenarios) {
    writeFileSync(path.join(dir, "scenarios.yaml"), scenarios);
  }
  const id = randomUUID().slice(0, 8);
  const email = `${id}@example.edu`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email,
    name: "Rowan",
  });
  const imported = await importStudyFolder(database.db, storage, dir, { teamId });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map(({ message }) => message).join("\n"));
  }
  const login = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const call = (method: string, url: string, body?: object) =>
    app.request(url, {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const versionId = imported.studyVersionId;
  /** Waits for the latest run to finish, as the Studies page does. */
  const finished = async (url = `/admin/versions/${versionId}/scenarios`) => {
    for (let tries = 0; tries < 100; tries++) {
      const tests = (await (await call("GET", url)).json()) as Tests;
      if (tests.latest && tests.latest.status !== "running") {
        return tests;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("The tests didn't finish.");
  };
  return { call, versionId, email, finished };
}

const pilots = async () =>
  database.db
    .select({ id: schema.participants.id })
    .from(schema.participants)
    .where(eq(schema.participants.isPilot, true));

describe("scenario tests on the server", () => {
  it("run from the button, and leave no test participants behind", async () => {
    const { call, versionId, finished } = await setUp();
    const before = (await pilots()).length;
    const started = await call("POST", `/admin/versions/${versionId}/scenarios`);
    expect(started.status).toBe(202);
    const tests = await finished();
    expect(tests).toMatchObject({ scenarios: 4, latest: { status: "passed", startedBy: "Rowan" } });
    expect(tests.latest.results).toHaveLength(4);
    expect((await pilots()).length).toBe(before);

    const listed = (await (await call("GET", "/admin/studies")).json()) as {
      studies: { versions: { id: string; tests: Tests }[]; warnUntested: boolean }[];
    };
    const version = listed.studies[0]?.versions.find(({ id }) => id === versionId);
    expect(version?.tests.latest.status).toBe("passed");
    expect(listed.studies[0]?.warnUntested).toBe(true);
  });

  it("say what failed", async () => {
    const { call, versionId, finished } = await setUp(`
scenarios:
  - name: Wrong on purpose
    condition: silent
    steps:
      - at: "0:10"
        expect: { happened: [sam-defends] }
`);
    await call("POST", `/admin/versions/${versionId}/scenarios`);
    const tests = await finished();
    expect(tests.latest).toMatchObject({
      status: "failed",
      results: [
        {
          name: "Wrong on purpose",
          passed: false,
          problems: [
            'At 0:10, "sam-defends" should have happened, but it\'s only in "defended", and they\'re in "silent".',
          ],
        },
      ],
    });
  });

  it("run by themselves when a version is saved", async () => {
    const { call, versionId, email, finished } = await setUp();
    const [researcher] = await database.db
      .select({ id: schema.researchers.id })
      .from(schema.researchers)
      .where(eq(schema.researchers.email, email));
    const opened = await openDraft(database.db, versionId, researcher?.id as string);
    const draftId = opened?.draftId as string;
    await saveSection(database.db, draftId, researcher?.id as string, {
      section: "page:scenarios.yaml",
      value: `
scenarios:
  - name: Jake mocks Maya
    condition: silent
    steps:
      - { at: "0:05", expect: { happened: [jake-mocks] } }
`,
      baseRevision: 0,
    });
    const saved = await call("POST", `/admin/drafts/${draftId}/freeze`);
    expect(saved.status).toBe(200);
    const [study] = await database.db
      .select({ studyId: schema.studyVersions.studyId })
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.id, versionId));
    const [newest] = await database.db
      .select({ id: schema.studyVersions.id })
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.studyId, study?.studyId as string))
      .orderBy(desc(schema.studyVersions.version))
      .limit(1);
    expect(newest?.id).not.toBe(versionId);
    const tests = await finished(`/admin/versions/${newest?.id}/scenarios`);
    expect(tests).toMatchObject({
      scenarios: 1,
      latest: { status: "passed", startedBy: "saving the version" },
    });
  });

  it("can stop warning before launch, for one study", async () => {
    const { call } = await setUp();
    const listed = (await (await call("GET", "/admin/studies")).json()) as {
      studies: { id: string }[];
    };
    const studyId = listed.studies[0]?.id as string;
    const off = await call("PUT", `/admin/studies/${studyId}/scenario-warning`, { warn: false });
    expect(await off.json()).toEqual({ warn: false });
    const [study] = await database.db
      .select({ warn: schema.studies.warnUntested })
      .from(schema.studies)
      .where(eq(schema.studies.id, studyId));
    expect(study?.warn).toBe(false);
  });

  it("need scenarios to run", async () => {
    const { call, versionId } = await setUp("scenarios: []\n");
    const response = await call("POST", `/admin/versions/${versionId}/scenarios`);
    expect(response.status).toBe(400);
  });
});
