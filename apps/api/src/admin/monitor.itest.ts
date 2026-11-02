import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addResearcherToTeam, setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];

async function signIn(email: string, password: string) {
  const response = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

const call = (cookie: string, method: string, url: string, body?: object) =>
  app.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

async function lab() {
  const id = randomUUID().slice(0, 8);
  const email = `${id}@example.edu`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email,
    name: "Owner",
  });
  const dir = mkdtempSync(path.join(tmpdir(), "truman-monitor-"));
  dirs.push(dir);
  const slug = `monitor-${id}`;
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Monitor test
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: blocked, blockSize: 2 }
  arms: [{ key: a }, { key: b }]
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }, { step: exit }]
`,
    "actors.csv": "username,name\nann,Ann\n",
    "posts.csv": "id,body,actor,likes,time\np1,hello,ann,0,-1:00\n",
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, { teamId, launch: true });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  const [study] = await database.db
    .select({ id: schema.studies.id })
    .from(schema.studies)
    .where(eq(schema.studies.slug, slug));
  return {
    id,
    slug,
    teamId,
    studyId: study?.id as string,
    versionId: imported.studyVersionId,
    cookie: await signIn(email, password as string),
  };
}

type Lab = Awaited<ReturnType<typeof lab>>;

async function member(team: Lab, role: "editor" | "viewer") {
  const email = `${role}-${randomUUID().slice(0, 8)}@example.edu`;
  const added = await addResearcherToTeam(database.db, {
    teamSlug: `lab-${team.id}`,
    email,
    name: role,
    role,
  });
  if (added.status !== "added") {
    throw new Error("Not added");
  }
  return signIn(email, added.password as string);
}

async function enter(slug: string, externalId = `p-${randomUUID()}`) {
  const response = await app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId }),
  });
  expect(response.status).toBe(200);
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return { cookie, externalId };
}

const meta = () => ({ clientEventId: randomUUID(), occurredAt: new Date().toISOString() });

const act = (cookie: string, url: string, body: object = {}) =>
  app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ ...meta(), ...body }),
  });

async function firstPostId(cookie: string) {
  const response = await app.request("/feed", { headers: { cookie } });
  const { posts } = (await response.json()) as { posts: { id: string }[] };
  return posts[0]?.id as string;
}

interface Monitor {
  enrolled: number;
  inProgress: number;
  completed: number;
  activeRecently: number;
  declined: number;
  withdrawn: number;
  liveVersion: number | null;
  conditions: {
    key: string;
    enrolled: number;
    expectedShare: number;
    comments: number;
    likes: number;
  }[];
  steps: { version: number; steps: { label: string; people: number }[] }[];
  enrolledByDay: { day: string; people: number }[];
  exports: { by: string; includedRecruitmentIds: boolean }[];
}

const monitor = async (team: Lab, cookie = team.cookie) => {
  const response = await call(cookie, "GET", `/admin/studies/${team.studyId}/monitor`);
  expect(response.status).toBe(200);
  return (await response.json()) as Monitor;
};

async function exported(team: Lab, cookie = team.cookie, options: object = {}) {
  const response = await call(cookie, "POST", `/admin/studies/${team.studyId}/export`, options);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/zip");
  return unzipSync(new Uint8Array(await response.arrayBuffer()));
}

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
  storage.close();
  await database.destroy();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("monitoring a study", () => {
  it("counts people and what they do, by condition", async () => {
    const team = await lab();
    const first = await enter(team.slug);
    await enter(team.slug);

    const postId = await firstPostId(first.cookie);
    await act(first.cookie, `/content/${postId}/like`, { active: true });
    await act(first.cookie, `/content/${postId}/comments`, { body: "Nice" });

    const seen = await monitor(team);
    expect(seen).toMatchObject({ enrolled: 2, inProgress: 2, completed: 0, liveVersion: 1 });
    // Joining counts as doing something.
    expect(seen.activeRecently).toBe(2);

    // Blocks of two put one person in each.
    expect(seen.conditions.map(({ key, enrolled }) => [key, enrolled])).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
    expect(seen.conditions[0]?.expectedShare).toBe(0.5);
    expect(seen.conditions.flatMap(({ likes }) => likes).reduce((a, b) => a + b)).toBe(1);
    expect(seen.conditions.flatMap(({ comments }) => comments).reduce((a, b) => a + b)).toBe(1);

    expect(seen.steps).toEqual([
      {
        version: 1,
        steps: [
          { label: "In the feed", people: 2 },
          { label: "At the exit", people: 0 },
        ],
      },
    ]);
    expect(seen.enrolledByDay.at(-1)?.people).toBe(2);
  });

  it("leaves out test participants", async () => {
    const team = await lab();
    const pilot = await call(team.cookie, "POST", `/admin/versions/${team.versionId}/pilot`, {
      condition: "a",
    });
    expect(pilot.status).toBe(200);
    expect(await monitor(team)).toMatchObject({ enrolled: 0, inProgress: 0 });
  });

  it("is only for the study's team, and doesn't identify anyone", async () => {
    const team = await lab();
    const other = await lab();
    await enter(team.slug, "SECRET-RECRUITMENT-ID");

    const denied = await call(other.cookie, "GET", `/admin/studies/${team.studyId}/monitor`);
    expect(denied.status).toBe(404);

    const text = JSON.stringify(await monitor(team));
    expect(text).not.toContain("SECRET-RECRUITMENT-ID");
  });
});

describe("downloading data", () => {
  it("gives a zip with the same files as the command line, and records who took it", async () => {
    const team = await lab();
    const { cookie } = await enter(team.slug);
    await act(cookie, `/content/${await firstPostId(cookie)}/like`, { active: true });

    const files = await exported(team);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(["events.csv", "impressions.csv", "summary.csv", "codebook.md"]),
    );
    expect(Object.keys(files)).not.toContain("recruitment_ids.csv");
    expect(strFromU8(files["events.csv"] as Uint8Array)).toContain("content.liked");

    expect((await monitor(team)).exports[0]).toMatchObject({
      by: expect.stringContaining("@example.edu"),
      includedRecruitmentIds: false,
    });
  });

  it("only gives recruitment IDs to the owner, and records it", async () => {
    const team = await lab();
    await enter(team.slug, "PAY-THIS-PERSON");
    const editor = await member(team, "editor");

    const refused = await call(editor, "POST", `/admin/studies/${team.studyId}/export`, {
      includeRecruitmentIds: true,
    });
    expect(refused.status).toBe(403);
    expect((await monitor(team)).exports).toEqual([]);

    const files = await exported(team, team.cookie, { includeRecruitmentIds: true });
    expect(strFromU8(files["recruitment_ids.csv"] as Uint8Array)).toContain("PAY-THIS-PERSON");
    expect((await monitor(team)).exports[0]?.includedRecruitmentIds).toBe(true);
  });

  it("isn't available to viewers or other teams", async () => {
    const team = await lab();
    const other = await lab();
    const viewer = await member(team, "viewer");
    const url = `/admin/studies/${team.studyId}/export`;

    expect((await call(viewer, "POST", url, {})).status).toBe(403);
    expect((await call(other.cookie, "POST", url, {})).status).toBe(404);
    // Viewers can still see how it's going.
    expect((await monitor(team, viewer)).enrolled).toBe(0);
  });
});

describe("withdrawing someone", () => {
  it("deletes them, counts it, and stops them coming back", async () => {
    const team = await lab();
    const person = await enter(team.slug);
    await act(person.cookie, `/content/${await firstPostId(person.cookie)}/like`, { active: true });

    const url = `/admin/studies/${team.studyId}/withdraw`;
    const done = await call(team.cookie, "POST", url, {
      externalId: person.externalId,
      reason: "They asked",
    });
    expect(done.status).toBe(200);
    expect(((await done.json()) as { eventsDeleted: number }).eventsDeleted).toBeGreaterThan(0);

    expect(await monitor(team)).toMatchObject({ enrolled: 0, withdrawn: 1, declined: 0 });
    const back = await app.request(`/studies/${team.slug}/enter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId: person.externalId }),
    });
    expect(back.status).not.toBe(200);

    const [record] = await database.db
      .select()
      .from(schema.dataDeletions)
      .where(eq(schema.dataDeletions.studyId, team.studyId));
    expect(record).toMatchObject({ reason: "They asked" });
    expect(record?.requestedBy).toContain("@example.edu");
  });

  it("says when there's nobody with that ID, and changes nothing", async () => {
    const team = await lab();
    await enter(team.slug);
    const response = await call(team.cookie, "POST", `/admin/studies/${team.studyId}/withdraw`, {
      externalId: "NOBODY",
      reason: "Testing",
    });
    expect(response.status).toBe(404);
    expect((await monitor(team)).enrolled).toBe(1);
  });

  it("can't reach another team's participant, or be done by a viewer", async () => {
    const team = await lab();
    const other = await lab();
    const person = await enter(team.slug);
    const viewer = await member(team, "viewer");
    const url = `/admin/studies/${team.studyId}/withdraw`;
    const body = { externalId: person.externalId, reason: "x" };

    expect((await call(other.cookie, "POST", url, body)).status).toBe(404);
    expect((await call(viewer, "POST", url, body)).status).toBe(403);
    expect((await monitor(team)).enrolled).toBe(1);
  });
});

describe("the placeholder consent text", () => {
  it("is flagged on a new study until it's replaced", async () => {
    const team = await lab();
    const started = await call(team.cookie, "POST", "/admin/studies", {
      teamId: team.teamId,
      title: "New",
      slug: `new-${team.id}`,
      assignment: "uniform",
      packId: null,
    });
    const { draftId } = (await started.json()) as { draftId: string };

    const issues = async () => {
      const response = await call(team.cookie, "GET", `/admin/drafts/${draftId}/settings`);
      return ((await response.json()) as { issues: { message: string }[] }).issues
        .map(({ message }) => message)
        .join();
    };
    expect(await issues()).toContain("placeholder");

    const freeze = async () => {
      await call(team.cookie, "POST", `/admin/drafts/${draftId}/freeze`);
      const [version] = await database.db
        .select({ id: schema.studyVersions.id })
        .from(schema.studyVersions)
        .innerJoin(schema.studies, eq(schema.studies.id, schema.studyVersions.studyId))
        .where(eq(schema.studies.slug, `new-${team.id}`));
      const info = await call(team.cookie, "GET", `/admin/versions/${version?.id}/preview-info`);
      return ((await info.json()) as { placeholderConsent: boolean }).placeholderConsent;
    };

    const saved = await call(team.cookie, "PUT", `/admin/drafts/${draftId}/settings`, {
      section: "page:pages/consent.md",
      value: "# Consent\n\nOur approved text.",
      baseRevision: 0,
    });
    expect(saved.status).toBe(200);
    expect(await issues()).not.toContain("placeholder");
    expect(await freeze()).toBe(false);
  });

  it("is flagged when launching a version that still has it", async () => {
    const team = await lab();
    const started = await call(team.cookie, "POST", "/admin/studies", {
      teamId: team.teamId,
      title: "New",
      slug: `keep-${team.id}`,
      assignment: "uniform",
      packId: null,
    });
    const { draftId } = (await started.json()) as { draftId: string };
    await call(team.cookie, "POST", `/admin/drafts/${draftId}/freeze`);
    const [version] = await database.db
      .select({ id: schema.studyVersions.id })
      .from(schema.studyVersions)
      .innerJoin(schema.studies, eq(schema.studies.id, schema.studyVersions.studyId))
      .where(eq(schema.studies.slug, `keep-${team.id}`));
    const info = await call(team.cookie, "GET", `/admin/versions/${version?.id}/preview-info`);
    expect(((await info.json()) as { placeholderConsent: boolean }).placeholderConsent).toBe(true);
  });
});
