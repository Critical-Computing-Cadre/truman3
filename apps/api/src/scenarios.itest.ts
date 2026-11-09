import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { loadStudyFolder } from "@truman3/study-files";
import { importStudyFolder } from "@truman3/study-import";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScenarios } from "./scenarios/run.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];
const EXAMPLES = path.resolve(import.meta.dirname, "../../../studies/examples");

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

/** Imports a study folder for a new team, and runs its scenarios. */
async function run(folder: string) {
  const id = randomUUID().slice(0, 8);
  const email = `${id}@example.edu`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email,
    name: "Tester",
  });
  const imported = await importStudyFolder(database.db, storage, folder, { teamId });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map(({ message }) => message).join("\n"));
  }
  const { definition } = loadStudyFolder(folder);
  return runScenarios({
    db: database.db,
    storage,
    versionId: imported.studyVersionId,
    scenarios: definition?.scenarios ?? [],
    researcher: { email, password: password as string },
  });
}

describe("scenario tests", () => {
  const examples = readdirSync(EXAMPLES).filter((name) =>
    existsSync(path.join(EXAMPLES, name, "scenarios.yaml")),
  );

  it.each(examples)("all pass for the example study %s", async (name) => {
    const results = await run(path.join(EXAMPLES, name));
    expect(results.length).toBeGreaterThan(0);
    expect(results.filter(({ passed }) => !passed)).toEqual([]);
  });

  it("fast-forward through a study, so what a decision point measures is when it happened", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "truman-scenarios-"));
    dirs.push(dir);
    const files: Record<string, string> = {
      "study.yaml": `
schemaVersion: 1
slug: scenarios-${randomUUID().slice(0, 8)}
title: Scenarios
site: { name: Demo }
length: { days: 3 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }, { key: lapsed, weight: 0 }]
platform: { style: text, template: shortPosts }
feed: { ranker: chronological }
flow: [{ step: feed }, { step: exit }]
`,
      "actors.csv": "username,name\nann,Ann Lee\n",
      "posts.csv": "id,body,actor,time\np1,Hello from Ann,ann,-1:00\n",
      "beats.yaml": `
beats:
  - id: miss-you
    when: { beat: day-2 }
    conditions: [lapsed]
    do: { action: post, actor: ann, text: "Haven't seen you in a while!" }
decide:
  - id: day-2
    when: { time: "48:00" }
    measure:
      lately: { count: post, within: "24:00" }
      ever: { count: post }
    groups:
      - { name: lapsed, if: { lately: { atMost: 0 } }, to: { lapsed: 1 } }
`,
      "scenarios.yaml": `
scenarios:
  - name: Someone who posted on day 1 but not day 2 is moved
    condition: a
    steps:
      - { at: "2:00", post: First day! }
      - { at: "10:00", comment: Nice, on: { post: p1 } }
      - at: "47:59"
        expect: { condition: a, notHappened: [day-2] }
      - at: "48:01"
        expect:
          happened: [day-2, miss-you]
          condition: lapsed
          sees: ["Haven't seen you in a while!", First day!]
  - name: Someone who posted on day 2 stays
    condition: a
    steps:
      - { at: "30:00", post: Back again }
      - at: "48:01"
        expect: { happened: [day-2], notHappened: [miss-you], condition: a }
  - name: A wrong expectation says what happened instead
    condition: a
    steps:
      - at: "1:00"
        expect: { happened: [day-2], condition: lapsed }
`,
    };
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), text);
    }
    const [moved, stays, wrong] = await run(dir);
    expect(moved).toEqual({ name: expect.any(String), passed: true, problems: [] });
    expect(stays).toEqual({ name: expect.any(String), passed: true, problems: [] });
    expect(wrong?.problems).toEqual([
      'At 1:00, "day-2" should have happened, but it\'s set for 48:00.',
      'At 1:00, they should be in "lapsed", but they\'re in "a".',
    ]);
  });
});
