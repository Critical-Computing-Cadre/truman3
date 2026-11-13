import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { eq, sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createLabKeys, memoryKeyService } from "./lab-keys.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const dirs: string[] = [];
const service = memoryKeyService();
const labKeys = createLabKeys(service);

const cookieFrom = (response: Response) =>
  (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
const as = (cookie: string, url: string, body?: object) =>
  app.request(url, {
    method: body ? "POST" : "GET",
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const enter = (slug: string, externalId: string) =>
  app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ externalId }),
  });

/** A lab with a study that isn't open yet, so the lab has no key. */
async function lab() {
  const id = randomUUID().slice(0, 8);
  const email = `${id}@example.edu`;
  const slug = `keys-${id}`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email,
    name: "Owner",
  });
  const dir = mkdtempSync(path.join(tmpdir(), "truman-keys-"));
  dirs.push(dir);
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Keys
site: { name: Demo }
length: { days: 2 }
entry: { idParam: PID, idLabel: ID, source: test }
conditions:
  assignment: { method: uniform }
  arms: [{ key: a }]
privacy: { storeIpAddress: true }
flow:
  - { step: feed }
  - { step: exit, redirect: "https://example.edu/done?id={externalId}" }
`,
    "actors.csv": "username,name\nann,Ann\n",
    "posts.csv": "id,body,actor,likes,time\np1,hello,ann,0,-1:00\n",
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text);
  }
  const imported = await importStudyFolder(database.db, storage, dir, { teamId });
  if (imported.status === "failed") {
    throw new Error(imported.issues.map((issue) => issue.message).join("\n"));
  }
  const researcher = cookieFrom(
    await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
  const [study] = await database.db
    .select()
    .from(schema.studies)
    .where(eq(schema.studies.slug, slug));
  return {
    slug,
    teamId,
    researcher,
    versionId: imported.studyVersionId,
    studyId: study?.id as string,
  };
}
const launch = (researcher: string, versionId: string) =>
  as(researcher, `/admin/versions/${versionId}/launch`, {});
const teamRow = async (teamId: string) =>
  (await database.db.select().from(schema.teams).where(eq(schema.teams.id, teamId)))[0];
const people = (studyId: string) =>
  database.db.select().from(schema.participants).where(eq(schema.participants.studyId, studyId));

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
  app = createApp({
    pingDatabase: database.ping,
    db: database.db,
    storage,
    labKeys,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => "203.0.113.9",
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

describe("a lab's own key (ADR 82)", () => {
  it("is made when the lab first opens a study to participants, and only once", async () => {
    const { teamId, researcher, versionId } = await lab();
    expect((await teamRow(teamId))?.keyId).toBeNull();

    expect((await launch(researcher, versionId)).status).toBe(200);
    const team = await teamRow(teamId);
    expect(team?.keyId).toBe(`memory-lab-${team?.slug.slice(4)}`);
    expect(team?.dataKeyWrapped).toBeTruthy();

    await launch(researcher, versionId);
    expect(service.made.filter((key) => key === team?.keyId)).toHaveLength(1);
  });

  it("keeps a participant's ID and address out of the database, and still knows them when they come back", async () => {
    const { studyId, slug, researcher, versionId } = await lab();
    await launch(researcher, versionId);

    const first = await enter(slug, "PROLIFIC-5f3a9c");
    expect(first.status).toBe(200);
    const [person] = await people(studyId);
    expect(person?.externalId).toMatch(/^id:v1:/);
    expect(person?.externalIdSealed).toMatch(/^sealed:v1:/);

    // Nowhere in what's stored about them.
    const [found] = await database.db.execute<{ n: number }>(sql`
      select (select count(*) from participants where participants::text like '%5f3a9c%')
           + (select count(*) from events where events::text like '%5f3a9c%' or events::text like '%203.0.113.9%')
           as n`);
    expect(Number(found?.n)).toBe(0);
    const [started] = await database.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.participantId, person?.id as string));
    expect((started?.payload as { ipAddress: string } | undefined)?.ipAddress).toMatch(
      /^sealed:v1:/,
    );

    expect((await enter(slug, "PROLIFIC-5f3a9c")).status).toBe(200);
    expect(await people(studyId)).toHaveLength(1);
    await enter(slug, "PROLIFIC-someone-else");
    expect(await people(studyId)).toHaveLength(2);
  });

  it("doesn't let someone in as another person by typing what that person is stored as", async () => {
    const { studyId, slug, researcher, versionId } = await lab();
    await launch(researcher, versionId);
    await enter(slug, "real-person");
    const [real] = await people(studyId);

    await enter(slug, real?.externalId as string);

    const everyone = await people(studyId);
    expect(everyone).toHaveLength(2);
    expect(everyone.filter(({ externalId }) => externalId === real?.externalId)).toHaveLength(1);
  });

  it("still knows someone who entered before the lab had a key", async () => {
    const { studyId, slug, teamId, versionId } = await lab();
    // Opened from the command line, which makes no key.
    await importStudyFolder(database.db, storage, dirs.at(-1) as string, { teamId, launch: true });
    expect(versionId).toBeTruthy();
    await enter(slug, "early-bird");
    await labKeys.ensure(database.db, teamId);

    expect((await enter(slug, "early-bird")).status).toBe(200);
    const everyone = await people(studyId);
    expect(everyone).toHaveLength(1);
    expect(everyone[0]).toMatchObject({ externalId: "early-bird", externalIdSealed: null });
  });

  it("puts the real ID in the link they leave by", async () => {
    const { slug, researcher, versionId } = await lab();
    await launch(researcher, versionId);
    const cookie = cookieFrom(await enter(slug, "PROLIFIC-77"));

    const step = (position: number) =>
      as(cookie, "/me/flow/advance", {
        clientEventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        position,
      });
    // The study runs two days, so their world is made to have started three days ago.
    await database.db
      .update(schema.worlds)
      .set({ startedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) });
    const flow = (await (await as(cookie, "/me/flow")).json()) as { position: number };
    const left = await step(flow.position);
    const { redirectUrl } = (await left.json()) as { redirectUrl: string };
    expect(redirectUrl).toBe("https://example.edu/done?id=PROLIFIC-77");
  });

  it("withdraws someone by their ID, and they can't come back", async () => {
    const { studyId, slug, researcher, versionId } = await lab();
    await launch(researcher, versionId);
    await enter(slug, "wants-out");

    const withdrawn = await as(researcher, `/admin/studies/${studyId}/withdraw`, {
      externalId: "wants-out",
      reason: "asked",
    });
    expect(withdrawn.status).toBe(200);
    expect(await people(studyId)).toHaveLength(0);
    expect((await enter(slug, "wants-out")).status).toBe(403);
  });

  it("opens IDs and addresses for the lab's own download", async () => {
    const { studyId, slug, researcher, versionId } = await lab();
    await launch(researcher, versionId);
    await enter(slug, "PROLIFIC-export");

    const exported = await as(researcher, `/admin/studies/${studyId}/export`, {
      includeRecruitmentIds: true,
    });
    expect(exported.status).toBe(200);
    const files = unzipSync(new Uint8Array(await exported.arrayBuffer()));
    const text = (name: string) => Buffer.from(files[name] as Uint8Array).toString("utf8");
    expect(text("recruitment_ids.csv")).toContain("PROLIFIC-export");
    expect(text("events.csv")).toContain("203.0.113.9");
    expect(text("events.csv")).not.toContain("sealed:v1:");
  });
});

describe("when a lab's key can't be made", () => {
  it("doesn't open the study, and says why", async () => {
    const failing = createApp({
      pingDatabase: database.ping,
      db: database.db,
      storage,
      labKeys: createLabKeys({
        encryptsStorage: false,
        create: async () => {
          throw new Error("no");
        },
        unwrap: async () => Buffer.alloc(32),
      }),
      mediaPublicUrl: "http://media.test",
      getClientIp: () => undefined,
      secureCookies: false,
    });
    const { studyId, researcher, versionId } = await lab();

    const refused = await failing.request(`/admin/versions/${versionId}/launch`, {
      method: "POST",
      headers: { cookie: researcher, "content-type": "application/json" },
      body: "{}",
    });

    expect(refused.status).toBe(503);
    expect(((await refused.json()) as { error: string }).error).toMatch(
      /encryption key couldn't be made/,
    );
    const [study] = await database.db
      .select()
      .from(schema.studies)
      .where(eq(schema.studies.id, studyId));
    expect(study?.liveVersionId).toBeNull();
  });
});

describe("a Truman with no keys for labs", () => {
  it("stores IDs as it always has", async () => {
    const plain = createApp({
      pingDatabase: database.ping,
      db: database.db,
      storage,
      mediaPublicUrl: "http://media.test",
      getClientIp: () => undefined,
      secureCookies: false,
    });
    const { studyId, slug, teamId } = await lab();
    await importStudyFolder(database.db, storage, dirs.at(-1) as string, { teamId, launch: true });
    await plain.request(`/studies/${slug}/enter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId: "as-before" }),
    });
    expect(await people(studyId)).toMatchObject([
      { externalId: "as-before", externalIdSealed: null },
    ]);
    expect(readFileSync(path.join(dirs.at(-1) as string, "study.yaml"), "utf8")).toContain(slug);
  });
});
