import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addResearcherToTeam, setUpTeam } from "@truman3/accounts";
import type { FeedPost, FeedResponse } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { exportStudy } from "@truman3/study-export";
import { importStudyFolder } from "@truman3/study-import";
import { eq } from "drizzle-orm";
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

async function importFiles(slug: string, teamId: string, body: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-launch-"));
  dirs.push(dir);
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Launch test
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: blocked, blockSize: 2 }
  arms: [{ key: a }, { key: b }]
media: { baseUrl: "https://cdn.example.com/m" }
flow: [{ step: feed }]
`,
    "actors.csv": "username,name\nann,Ann\n",
    "posts.csv": `id,body,actor,time,condition\np1,${body},ann,-1:00,\nfor-a,only a,ann,-0:30,a\n`,
  };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  const result = await importStudyFolder(database.db, storage, dir, { teamId });
  if (result.status === "failed") {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  return result.studyVersionId;
}

async function lab() {
  const id = randomUUID().slice(0, 8);
  const teamSlug = `lab-${id}`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: teamSlug,
    slug: teamSlug,
    email: `${id}@example.edu`,
    name: "Owner",
  });
  const slug = `launch-${id}`;
  const v1 = await importFiles(slug, teamId, "first version");
  const cookie = await signIn(`${id}@example.edu`, password as string);
  return { id, teamId, teamSlug, slug, v1, cookie };
}

type Lab = Awaited<ReturnType<typeof lab>>;

const launch = (team: Lab, versionId: string, cookie = team.cookie) =>
  app.request(`/admin/versions/${versionId}/launch`, {
    method: "POST",
    headers: { cookie },
  });

async function studyId(team: Lab) {
  const [study] = await database.db
    .select()
    .from(schema.studies)
    .where(eq(schema.studies.slug, team.slug));
  return study!;
}

const enter = (slug: string, externalId = `p-${randomUUID()}`) =>
  app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId }),
  });

const cookieOf = (response: Response) =>
  (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

async function feedOf(cookie: string) {
  const response = await app.request("/feed", { headers: { cookie } });
  return ((await response.json()) as FeedResponse).posts;
}

const bodies = (posts: FeedPost[]) => posts.map((post) => post.body);

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => undefined,
    secureCookies: true,
  });
});

afterAll(async () => {
  storage.close();
  await database.destroy();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("before launching", () => {
  it("keeps participants out of a study that was only imported", async () => {
    const team = await lab();

    const response = await enter(team.slug);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "This isn't available right now." });
    const rows = await database.db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.studyId, (await studyId(team)).id));
    expect(rows).toEqual([]);
  });

  it("doesn't show the entry page for a study that's never been live", async () => {
    const team = await lab();
    expect((await app.request(`/studies/${team.slug}/entry`)).status).toBe(404);
  });
});

describe("launching", () => {
  it("opens the study to participants, on that version", async () => {
    const team = await lab();

    const response = await launch(team, team.v1);

    expect(await response.json()).toEqual({ version: 1 });
    const cookie = cookieOf(await enter(team.slug));
    expect(bodies(await feedOf(cookie))).toContain("first version");
  });

  it("isn't changed by saving a newer version", async () => {
    const team = await lab();
    await launch(team, team.v1);

    await importFiles(team.slug, team.teamId, "second version");

    const cookie = cookieOf(await enter(team.slug));
    expect(bodies(await feedOf(cookie))).toContain("first version");
    expect(bodies(await feedOf(cookie))).not.toContain("second version");
  });

  it("gives new participants a newly launched version, and leaves others where they are", async () => {
    const team = await lab();
    await launch(team, team.v1);
    const earlier = cookieOf(await enter(team.slug));
    const v2 = await importFiles(team.slug, team.teamId, "second version");

    await launch(team, v2);

    const later = cookieOf(await enter(team.slug));
    expect(bodies(await feedOf(later))).toContain("second version");
    expect(bodies(await feedOf(earlier))).toContain("first version");
  });

  it("can go back to an earlier version", async () => {
    const team = await lab();
    const v2 = await importFiles(team.slug, team.teamId, "second version");
    await launch(team, v2);

    await launch(team, team.v1);

    const cookie = cookieOf(await enter(team.slug));
    expect(bodies(await feedOf(cookie))).toContain("first version");
  });

  it("keeps a record of who launched what, and when", async () => {
    const team = await lab();
    await launch(team, team.v1);

    const rows = await database.db
      .select()
      .from(schema.studyLaunches)
      .where(eq(schema.studyLaunches.studyId, (await studyId(team)).id));

    expect(rows).toMatchObject([
      { action: "launch", versionId: team.v1, by: `${team.id}@example.edu` },
    ]);
  });
});

describe("stopping new participants", () => {
  it("keeps new people out, while people already in can come back", async () => {
    const team = await lab();
    await launch(team, team.v1);
    const id = `p-${randomUUID()}`;
    await enter(team.slug, id);
    const { id: study } = await studyId(team);

    const stopped = await app.request(`/admin/studies/${study}/stop`, {
      method: "POST",
      headers: { cookie: team.cookie },
    });

    expect(stopped.status).toBe(200);
    expect((await enter(team.slug)).status).toBe(403);
    const back = await enter(team.slug, id);
    expect(await back.json()).toEqual({ returning: true });
    expect(bodies(await feedOf(cookieOf(back)))).toContain("first version");
    expect((await app.request(`/studies/${team.slug}/entry`)).status).toBe(200);
  });
});

describe("who can launch", () => {
  it("doesn't let another team launch or stop a study", async () => {
    const mine = await lab();
    const other = await lab();
    const { id: study } = await studyId(mine);

    expect((await launch(mine, mine.v1, other.cookie)).status).toBe(404);
    const stop = await app.request(`/admin/studies/${study}/stop`, {
      method: "POST",
      headers: { cookie: other.cookie },
    });
    expect(stop.status).toBe(404);
  });

  it("doesn't let a viewer launch, or anyone signed out", async () => {
    const team = await lab();
    const email = `viewer-${team.id}@example.edu`;
    const added = await addResearcherToTeam(database.db, {
      teamSlug: team.teamSlug,
      email,
      name: "Viewer",
      role: "viewer",
    });
    const viewer = await signIn(email, (added as { password: string }).password);

    expect((await launch(team, team.v1, viewer)).status).toBe(403);
    expect((await launch(team, team.v1, "")).status).toBe(401);
  });

  it("can't launch a version from a different study", async () => {
    const mine = await lab();
    const other = await lab();

    expect((await launch(mine, other.v1)).status).toBe(404);
  });
});

describe("trying a version as a participant", () => {
  const pilot = async (team: Lab, condition: string, versionId = team.v1) => {
    const response = await app.request(`/admin/versions/${versionId}/pilot`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: team.cookie },
      body: JSON.stringify({ condition }),
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { token: string }).token;
  };

  const signInAsPilot = async (token: string) => {
    const response = await app.request("/pilot-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return cookieOf(response);
  };

  it("works on a version that isn't live, in the chosen condition", async () => {
    const team = await lab();

    const cookie = await signInAsPilot(await pilot(team, "a"));

    expect(bodies(await feedOf(cookie))).toEqual(["only a", "first version"]);
  });

  it("doesn't count as a participant: not in exports, and not using a block position", async () => {
    const team = await lab();
    await launch(team, team.v1);
    const cookie = await signInAsPilot(await pilot(team, "a"));
    await feedOf(cookie);
    const real = cookieOf(await enter(team.slug));
    await feedOf(real);

    const folder = mkdtempSync(path.join(tmpdir(), "truman-launch-export-"));
    dirs.push(folder);
    await exportStudy(database.db, team.slug, folder);

    const lines = (name: string) =>
      readFileSync(path.join(folder, name), "utf8").trim().split("\n");
    expect(lines("participants.csv")).toHaveLength(2);
    expect(lines("summary.csv")).toHaveLength(2);

    const [person] = await database.db
      .select({ id: schema.participants.id, isPilot: schema.participants.isPilot })
      .from(schema.participants)
      .where(eq(schema.participants.isPilot, true));
    expect(person?.isPilot).toBe(true);
    for (const file of ["participants.csv", "summary.csv", "events.csv", "impressions.csv"]) {
      expect(readFileSync(path.join(folder, file), "utf8")).not.toContain(person?.id);
    }
    expect(readFileSync(path.join(folder, "codebook.md"), "utf8")).toContain(
      "test participants aren't included",
    );

    const [assignment] = await database.db
      .select({ details: schema.assignments.details })
      .from(schema.assignments)
      .innerJoin(schema.participants, eq(schema.participants.id, schema.assignments.participantId))
      .where(eq(schema.participants.isPilot, false));
    expect(assignment?.details).toMatchObject({ position: 0 });
  });

  it("gives a fresh start each time", async () => {
    const team = await lab();

    expect(await pilot(team, "a")).not.toBe(await pilot(team, "a"));
  });

  it("doesn't work for a condition that isn't there, or another team", async () => {
    const mine = await lab();
    const other = await lab();

    const wrong = await app.request(`/admin/versions/${mine.v1}/pilot`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: mine.cookie },
      body: JSON.stringify({ condition: "nope" }),
    });
    expect(wrong.status).toBe(404);

    const foreign = await app.request(`/admin/versions/${mine.v1}/pilot`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: other.cookie },
      body: JSON.stringify({ condition: "a" }),
    });
    expect(foreign.status).toBe(404);
  });

  it("can't be used to sign in as a real participant", async () => {
    const team = await lab();
    await launch(team, team.v1);
    const real = cookieOf(await enter(team.slug));
    const token = real.split("=")[1] ?? "";

    const response = await app.request("/pilot-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
