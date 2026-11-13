import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeOperator, setUpTeam } from "@truman3/accounts";
import { HOSTED_STARTING_LIMITS } from "@truman3/core";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let hosted: ReturnType<typeof createApp>;
let selfHosted: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];
const PASSWORD = "a long enough password";

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
  const dependencies = {
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => undefined,
    secureCookies: false,
  };
  hosted = createApp({ ...dependencies, hosted: true });
  selfHosted = createApp(dependencies);
});

afterAll(async () => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  storage.close();
  await database.destroy();
});

/** What the operator page says about a team, as far as these tests look. */
interface Listed {
  id: string;
  status: string;
}
const json = async <T = Record<string, unknown>>(response: Response) =>
  (await response.json()) as T;

const send = (cookie: string, method: string, url: string, body?: object) =>
  hosted.request(url, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const application = (email: string) => ({
  lab: "Media Lab",
  name: "Pat Applicant",
  email,
  password: PASSWORD,
  institution: "State University",
  purpose: "Studying how labels change what people share.",
});

async function apply(email = `${randomUUID().slice(0, 8)}@example.edu`) {
  const response = await hosted.request("/admin/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(application(email)),
  });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return { response, cookie, email };
}

async function operator() {
  const id = randomUUID().slice(0, 8);
  const email = `op-${id}@example.org`;
  const { password } = await setUpTeam(database.db, {
    teamName: `Operators ${id}`,
    slug: `operators-${id}`,
    email,
    name: "Operator",
  });
  await makeOperator(database.db, email);
  const response = await hosted.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function teamOf(email: string) {
  const [row] = await database.db
    .select({ team: schema.teams })
    .from(schema.teams)
    .innerJoin(schema.teamMemberships, eq(schema.teamMemberships.teamId, schema.teams.id))
    .innerJoin(schema.researchers, eq(schema.researchers.id, schema.teamMemberships.researcherId))
    .where(eq(schema.researchers.email, email));
  return row!.team;
}

/** A small study for the team, and its version. */
async function studyFor(teamId: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-hosting-"));
  dirs.push(dir);
  const slug = `hosted-${randomUUID().slice(0, 8)}`;
  writeFileSync(
    path.join(dir, "study.yaml"),
    `
schemaVersion: 1
slug: ${slug}
title: Hosted
site: { name: Demo }
length: { days: 1 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }]
flow: [{ step: feed }]
`,
  );
  writeFileSync(path.join(dir, "actors.csv"), "username,name\nann,Ann\n");
  writeFileSync(path.join(dir, "posts.csv"), "id,body,actor,time\np1,Hello,ann,-1:00\n");
  const imported = await importStudyFolder(database.db, storage, dir, { teamId });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  return { slug, versionId: imported.studyVersionId };
}

const enter = (slug: string, externalId = randomUUID()) =>
  hosted.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId }),
  });

describe("a hosted Truman (ADR 70)", () => {
  it("takes a lab's application, signs them in, and lets them build but not launch", async () => {
    const { response, cookie, email } = await apply();
    expect(response.status).toBe(200);

    const me = await json(await send(cookie, "GET", "/admin/me"));
    expect(me).toMatchObject({
      email,
      hosted: true,
      operator: false,
      teams: [{ name: "Media Lab", role: "owner", status: "pending" }],
    });
    const team = await teamOf(email);
    expect(team.application).toMatchObject({ institution: "State University" });

    const { versionId } = await studyFor(team.id);
    const pilot = await send(cookie, "POST", `/admin/versions/${versionId}/pilot`, {
      condition: "a",
    });
    expect(pilot.status).toBe(200);
    const launch = await send(cookie, "POST", `/admin/versions/${versionId}/launch`);
    expect(launch.status).toBe(403);
    expect((await json<{ error: string }>(launch)).error).toMatch(/waiting to be approved/);

    const again = await apply(email);
    expect(again.response.status).toBe(409);
  });

  it("shows an operator every team, by counts, and lets them approve with the usual limits", async () => {
    const op = await operator();
    const { cookie, email } = await apply();
    const team = await teamOf(email);

    const list = await json<{ teams: Listed[] }>(await send(op, "GET", "/admin/operator/teams"));
    const listed = list.teams.find(({ id }) => id === team.id);
    expect(listed).toMatchObject({
      status: "pending",
      owners: [{ email }],
      usage: { members: 1, studies: 0, participants: 0 },
    });
    // Pending first, so an operator sees who's waiting.
    expect(list.teams[0]?.status).toBe("pending");

    const approved = await send(op, "PATCH", `/admin/operator/teams/${team.id}`, {
      status: "approved",
    });
    expect(await json(approved)).toMatchObject({
      status: "approved",
      limits: HOSTED_STARTING_LIMITS,
    });

    const { versionId } = await studyFor(team.id);
    expect((await send(cookie, "POST", `/admin/versions/${versionId}/launch`)).status).toBe(200);
  });

  it("keeps the operator page from anyone who isn't an operator, and from tokens", async () => {
    const { cookie } = await apply();
    expect((await send(cookie, "GET", "/admin/operator/teams")).status).toBe(403);
    expect((await send("", "GET", "/admin/operator/teams")).status).toBe(401);

    const op = await operator();
    const made = await send(op, "POST", "/admin/tokens", { name: "agent", days: 7 });
    const { token } = await json<{ token: string }>(made);
    const byToken = await hosted.request("/admin/operator/teams", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(byToken.status).toBe(403);
  });

  it("holds a team to its limits: studies running, and new participants a month", async () => {
    const op = await operator();
    const { cookie, email } = await apply();
    const team = await teamOf(email);
    await send(op, "PATCH", `/admin/operator/teams/${team.id}`, {
      status: "approved",
      limits: { runningStudies: 1, participantsPerMonth: 2 },
    });

    const first = await studyFor(team.id);
    const second = await studyFor(team.id);
    expect((await send(cookie, "POST", `/admin/versions/${first.versionId}/launch`)).status).toBe(
      200,
    );
    const refused = await send(cookie, "POST", `/admin/versions/${second.versionId}/launch`);
    expect(refused.status).toBe(403);
    expect((await json<{ error: string }>(refused)).error).toMatch(/1 studies open at once/);

    const ann = randomUUID();
    expect((await enter(first.slug, ann)).status).toBe(200);
    expect((await enter(first.slug)).status).toBe(200);
    // The month's two are used, so the third finds it closed.
    expect((await enter(first.slug)).status).toBe(403);
    // Someone already in can come back.
    expect((await enter(first.slug, ann)).status).toBe(200);
  });

  it("shows a lab its own limits and what it has used, and nobody else's", async () => {
    const op = await operator();
    const { cookie, email } = await apply();
    const team = await teamOf(email);
    await send(op, "PATCH", `/admin/operator/teams/${team.id}`, {
      status: "approved",
      limits: { runningStudies: 3, participantsPerMonth: 50, uploadsGb: 2 },
    });
    const { versionId, slug } = await studyFor(team.id);
    await send(cookie, "POST", `/admin/versions/${versionId}/launch`);
    await enter(slug);
    await enter(slug);

    expect(await json(await send(cookie, "GET", `/admin/teams/${team.id}/usage`))).toEqual({
      status: "approved",
      limits: { runningStudies: 3, participantsPerMonth: 50, uploadsGb: 2 },
      usage: { participantsLast30Days: 2, runningStudies: 1, uploadBytes: 0 },
    });

    const stranger = await apply();
    expect((await send(stranger.cookie, "GET", `/admin/teams/${team.id}/usage`)).status).toBe(404);
  });

  it("stops a suspended team's studies at once, for new and current participants", async () => {
    const op = await operator();
    const { cookie, email } = await apply();
    const team = await teamOf(email);
    await send(op, "PATCH", `/admin/operator/teams/${team.id}`, { status: "approved" });
    const study = await studyFor(team.id);
    await send(cookie, "POST", `/admin/versions/${study.versionId}/launch`);
    const entered = await enter(study.slug);
    const participant = (entered.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect((await send(participant, "GET", "/feed")).status).toBe(200);

    const suspended = await send(op, "PATCH", `/admin/operator/teams/${team.id}`, {
      status: "suspended",
    });
    expect(await json(suspended)).toMatchObject({
      status: "suspended",
      decidedBy: expect.any(String),
    });
    expect((await send(participant, "GET", "/feed")).status).toBe(401);
    expect((await enter(study.slug)).status).toBe(403);
    expect((await send(cookie, "POST", `/admin/versions/${study.versionId}/launch`)).status).toBe(
      403,
    );

    await send(op, "PATCH", `/admin/operator/teams/${team.id}`, { status: "approved" });
    expect((await send(participant, "GET", "/feed")).status).toBe(200);
  });

  it("takes no applications on a Truman that isn't hosted", async () => {
    const response = await selfHosted.request("/admin/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(application(`${randomUUID().slice(0, 8)}@example.edu`)),
    });
    expect(response.status).toBe(404);
    expect(await (await selfHosted.request("/admin/hosting")).json()).toEqual({ hosted: false });
  });
});
