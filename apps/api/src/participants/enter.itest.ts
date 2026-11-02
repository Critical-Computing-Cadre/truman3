import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { importStudyFolder } from "@truman3/study-import";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.ts";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const folders: string[] = [];
let counter = 0;

interface StudyOptions {
  assignment?: string;
  arms?: string;
  privacy?: string;
  extraComment?: string;
}

async function importStudy(slug: string, options: StudyOptions = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "truman-enter-"));
  folders.push(dir);
  const files: Record<string, string> = {
    "study.yaml": `
schemaVersion: 1
slug: ${slug}
title: Internal title
site: { name: PhotoApp }
length: { days: 2 }
entry: { idParam: PROLIFIC_PID, idLabel: Prolific ID, source: prolific }
conditions:
  assignment: ${options.assignment ?? "{ method: uniform }"}
  arms: ${options.arms ?? "[{ key: a }, { key: b }]"}
feed: { ranker: chronological }
${options.privacy ?? ""}
flow: [{ step: feed }]
`,
    "actors.csv": "username,name\nann,Ann\n",
    "posts.csv": "id,body,actor,time,condition\n1,one,ann,0:00,a\n2,two,ann,0:00,b\n",
    "comments.csv": `id,body,actor,postID,time\n1,${options.extraComment ?? "nice"},ann,1,0:05\n`,
  };
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  const result = await importStudyFolder(database.db, storage, dir);
  if (result.status === "failed") {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  return result;
}

function enter(slug: string, externalId: string, headers: Record<string, string> = {}) {
  return app.request(`/studies/${slug}/enter`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": IPHONE, ...headers },
    body: JSON.stringify({ externalId }),
  });
}

const sessionCookie = (response: Response) =>
  (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

const uniqueSlug = () => {
  counter += 1;
  return `study-${counter}`;
};

/** Everything stored for a participant, looked up by their recruitment ID. */
async function stored(externalId: string) {
  const { db } = database;
  const [participant] = await db
    .select()
    .from(schema.participants)
    .where(eq(schema.participants.externalId, externalId));
  if (!participant) {
    throw new Error(`No participant "${externalId}".`);
  }
  const where = eq(schema.assignments.participantId, participant.id);
  return {
    participant,
    assignments: await db.select().from(schema.assignments).where(where),
    memberships: await db
      .select()
      .from(schema.worldMemberships)
      .where(eq(schema.worldMemberships.participantId, participant.id)),
    events: await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.participantId, participant.id)),
  };
}

beforeAll(async () => {
  database = await createTestDatabase();
  app = createApp({
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => "203.0.113.9",
    secureCookies: true,
  });
});

afterAll(async () => {
  storage.close();
  await database.destroy();
  for (const dir of folders) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("the entry page", () => {
  it("shows the site's name and what ID to ask for", async () => {
    const slug = uniqueSlug();
    await importStudy(slug);

    const response = await app.request(`/studies/${slug}/entry`);

    expect(await response.json()).toEqual({
      siteName: "PhotoApp",
      logoUrl: null,
      idLabel: "Prolific ID",
      idParam: "PROLIFIC_PID",
    });
  });

  it("gives the same neutral response for anything that doesn't exist", async () => {
    const response = await app.request("/studies/nope/entry");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "This page isn't available." });
  });
});

describe("entering for the first time", () => {
  it("creates a participant with a condition, a world, and an actor to act as", async () => {
    const slug = uniqueSlug();
    const { studyVersionId } = await importStudy(slug);
    const id = `first-${slug}`;

    const response = await enter(slug, id);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ returning: false });

    const { participant, assignments, memberships } = await stored(id);
    expect(participant).toMatchObject({ source: "prolific", status: "active" });
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      studyVersionId,
      method: "uniform",
      probability: 0.5,
      decisionPoint: null,
    });
    expect(memberships).toHaveLength(1);

    const [actor] = await database.db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.id, memberships[0]!.actorId));
    expect(actor).toMatchObject({ driver: "human", participantId: participant.id });
  });

  it("sets a protected session cookie, and keeps only a hash of the token", async () => {
    const slug = uniqueSlug();
    await importStudy(slug);
    const id = `cookie-${slug}`;

    const response = await enter(slug, id);
    const header = response.headers.get("set-cookie") ?? "";
    const token = sessionCookie(response).split("=")[1] ?? "";

    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(token.length).toBeGreaterThan(30);

    const { participant } = await stored(id);
    const sessions = await database.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.participantId, participant.id));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).not.toBe(token);
  });

  it("records the session with a coarse device summary only", async () => {
    const slug = uniqueSlug();
    await importStudy(slug);
    const id = `device-${slug}`;

    await enter(slug, id);

    const { events, assignments } = await stored(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "session.started",
      source: "participant",
      conditionId: assignments[0]?.conditionId,
      payload: { device: "phone", browser: "Safari" },
    });
  });

  it("rejects a missing ID", async () => {
    const slug = uniqueSlug();
    await importStudy(slug);

    expect((await enter(slug, "   ")).status).toBe(400);
  });

  it("can't enter a study that doesn't exist", async () => {
    expect((await enter("nope", "someone")).status).toBe(404);
  });
});

describe("coming back", () => {
  it("returns to the same world and condition, with a new session", async () => {
    const slug = uniqueSlug();
    await importStudy(slug);
    const id = `back-${slug}`;

    const first = await enter(slug, id);
    const before = await stored(id);
    const second = await enter(slug, id);
    const after = await stored(id);

    expect(await second.json()).toEqual({ returning: true });
    expect(sessionCookie(second)).not.toBe(sessionCookie(first));
    expect(after.assignments).toEqual(before.assignments);
    expect(after.memberships).toEqual(before.memberships);
    expect(after.events).toHaveLength(2);
  });

  it("stays on their version when a newer one is imported", async () => {
    const slug = uniqueSlug();
    const v1 = await importStudy(slug);
    const earlyId = `early-${slug}`;
    await enter(slug, earlyId);

    const v2 = await importStudy(slug, { extraComment: "changed" });
    const lateId = `late-${slug}`;
    await enter(slug, lateId);
    await enter(slug, earlyId);

    expect(v2.version).toBe(2);
    expect((await stored(earlyId)).assignments[0]?.studyVersionId).toBe(v1.studyVersionId);
    expect((await stored(lateId)).assignments[0]?.studyVersionId).toBe(v2.studyVersionId);
  });

  it("creates only one participant when the same ID enters twice at once", async () => {
    const slug = uniqueSlug();
    await importStudy(slug);
    const id = `twice-${slug}`;

    const responses = await Promise.all([enter(slug, id), enter(slug, id), enter(slug, id)]);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    const bodies = (await Promise.all(responses.map((response) => response.json()))) as {
      returning: boolean;
    }[];
    expect(bodies.filter((body) => !body.returning)).toHaveLength(1);
    expect((await stored(id)).assignments).toHaveLength(1);
  });
});

describe("the signed-in participant", () => {
  it("can see their username and the site, but not their condition or recruitment ID", async () => {
    const slug = uniqueSlug();
    await importStudy(slug);
    const id = `me-${slug}`;
    const cookie = sessionCookie(await enter(slug, id));

    const response = await app.request("/me", { headers: { cookie } });
    const text = await response.text();
    const body = JSON.parse(text);

    expect(response.status).toBe(200);
    expect(body.siteName).toBe("PhotoApp");
    expect(body.username).toBeTruthy();
    expect(text).not.toContain(id);
    expect(text).not.toMatch(/condition|participantId|externalId/i);
  });

  it("is rejected with no session, a wrong token, or an expired one", async () => {
    const slug = uniqueSlug();
    await importStudy(slug);
    const id = `expired-${slug}`;
    const cookie = sessionCookie(await enter(slug, id));

    expect((await app.request("/me")).status).toBe(401);
    expect((await app.request("/me", { headers: { cookie: "session=wrong" } })).status).toBe(401);

    const { participant } = await stored(id);
    await database.db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sessions.participantId, participant.id));
    expect((await app.request("/me", { headers: { cookie } })).status).toBe(401);
  });

  it("loses access when their data is deleted", async () => {
    const slug = uniqueSlug();
    await importStudy(slug);
    const id = `gone-${slug}`;
    const cookie = sessionCookie(await enter(slug, id));
    const { participant } = await stored(id);

    await database.db.execute(
      sql`select delete_participant_data(${participant.id}, 'withdrew', 'researcher')`,
    );

    expect((await app.request("/me", { headers: { cookie } })).status).toBe(401);
  });
});

describe("people who are out of a study", () => {
  const deleteData = (participantId: string) =>
    database.db.execute(
      sql`select delete_participant_data(${participantId}, 'withdrew', 'researcher')`,
    );

  it("can't re-enter after withdrawing, even though their data is gone", async () => {
    const slug = uniqueSlug();
    await importStudy(slug);
    const id = `withdrew-${slug}`;
    await enter(slug, id);
    await deleteData((await stored(id)).participant.id);

    const response = await enter(slug, id);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "This account is no longer active." });
    expect(response.headers.get("set-cookie")).toBeNull();
    const rows = await database.db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.externalId, id));
    expect(rows).toEqual([]);
  });

  it("can join a different study after withdrawing from one", async () => {
    const first = uniqueSlug();
    const second = uniqueSlug();
    await importStudy(first);
    await importStudy(second);
    const id = `moved-on-${first}`;
    await enter(first, id);
    await deleteData((await stored(id)).participant.id);

    expect((await enter(first, id)).status).toBe(403);
    expect((await enter(second, id)).status).toBe(200);
  });

  it("keeps only an unreadable hash, with nothing linking it to the deleted data", async () => {
    const slug = uniqueSlug();
    await importStudy(slug);
    const id = `hashed-${slug}`;
    await enter(slug, id);
    await deleteData((await stored(id)).participant.id);

    const rows = await database.db.select().from(schema.excludedEntries);
    expect(JSON.stringify(rows)).not.toContain(id);
    expect(Object.keys(rows[0]!).sort()).toEqual(["idHash", "studyId"]);
  });

  it("can't return after finishing, and loses any open session", async () => {
    const slug = uniqueSlug();
    await importStudy(slug);
    const id = `finished-${slug}`;
    const cookie = sessionCookie(await enter(slug, id));
    const before = await stored(id);

    await database.db
      .update(schema.participants)
      .set({ status: "completed" })
      .where(eq(schema.participants.id, before.participant.id));

    expect((await app.request("/me", { headers: { cookie } })).status).toBe(401);
    expect((await enter(slug, id)).status).toBe(403);
    expect((await stored(id)).events).toEqual(before.events);
  });
});

describe("too many entry attempts", () => {
  it("get slowed down, without storing the address", async () => {
    const slug = uniqueSlug();
    await importStudy(slug);
    let attempts = 0;
    const limited = createApp({
      pingDatabase: database.ping,
      db: database.db,
      storage,
      mediaPublicUrl: "http://media.test",
      getClientIp: () => "203.0.113.50",
      secureCookies: true,
      allowEntryAttempt: () => {
        attempts += 1;
        return attempts <= 1;
      },
    });
    const attempt = (externalId: string) =>
      limited.request(`/studies/${slug}/enter`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ externalId }),
      });
    const id = `limited-${slug}`;

    expect((await attempt(id)).status).toBe(200);
    expect((await attempt(`${id}-2`)).status).toBe(429);
    expect(JSON.stringify((await stored(id)).events)).not.toContain("203.0.113.50");
  });
});

describe("condition assignment", () => {
  it("balances blocks exactly, even when many people enroll at once", async () => {
    const slug = uniqueSlug();
    await importStudy(slug, {
      assignment: "{ method: blocked, blockSize: 4 }",
      arms: "[{ key: a }, { key: b }]",
    });

    const ids = Array.from({ length: 40 }, (_, i) => `block-${slug}-${i}`);
    const responses = await Promise.all(ids.map((id) => enter(slug, id)));
    expect(responses.every((response) => response.status === 200)).toBe(true);

    const [study] = await database.db
      .select()
      .from(schema.studies)
      .where(eq(schema.studies.slug, slug));
    const rows = await database.db
      .select({ assignment: schema.assignments, key: schema.conditions.key })
      .from(schema.assignments)
      .innerJoin(schema.conditions, eq(schema.conditions.id, schema.assignments.conditionId))
      .innerJoin(schema.participants, eq(schema.participants.id, schema.assignments.participantId))
      .where(eq(schema.participants.studyId, study!.id))
      .orderBy(asc(schema.assignments.id));

    expect(rows).toHaveLength(40);
    const positions = rows.map((row) => (row.assignment.details as { position: number }).position);
    expect([...positions].sort((a, b) => a - b)).toEqual(ids.map((_, i) => i));

    const byBlock = Object.groupBy(
      rows,
      (row) => (row.assignment.details as { block: number }).block,
    );
    expect(Object.keys(byBlock)).toHaveLength(10);
    for (const block of Object.values(byBlock)) {
      expect(block?.filter((row) => row.key === "a")).toHaveLength(2);
      expect(block?.filter((row) => row.key === "b")).toHaveLength(2);
    }
    expect(rows.every((row) => row.assignment.method === "blocked")).toBe(true);
  });

  it("doesn't reuse a block position after a withdrawal", async () => {
    const slug = uniqueSlug();
    await importStudy(slug, { assignment: "{ method: blocked, blockSize: 4 }" });
    const first = `w1-${slug}`;
    await enter(slug, first);
    const { participant } = await stored(first);

    await database.db.execute(
      sql`select delete_participant_data(${participant.id}, 'withdrew', 'researcher')`,
    );
    const second = `w2-${slug}`;
    await enter(slug, second);

    expect((await stored(second)).assignments[0]?.details).toMatchObject({ position: 1 });
  });

  it("records the weighted probability", async () => {
    const slug = uniqueSlug();
    await importStudy(slug, { arms: "[{ key: a, weight: 3 }, { key: b }]" });
    const id = `weight-${slug}`;

    await enter(slug, id);

    const [assignment] = (await stored(id)).assignments;
    const [condition] = await database.db
      .select()
      .from(schema.conditions)
      .where(eq(schema.conditions.id, assignment!.conditionId));
    expect(assignment?.probability).toBe(condition?.key === "a" ? 0.75 : 0.25);
  });
});

describe("IP addresses", () => {
  it("aren't stored by default, or even looked up", async () => {
    const slug = uniqueSlug();
    await importStudy(slug);
    const id = `noip-${slug}`;
    const getClientIp = vi.fn(() => "203.0.113.9");
    const localApp = createApp({
      pingDatabase: database.ping,
      db: database.db,
      storage,
      mediaPublicUrl: "http://media.test",
      getClientIp,
      secureCookies: true,
    });

    await localApp.request(`/studies/${slug}/enter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ externalId: id }),
    });

    expect(getClientIp).not.toHaveBeenCalled();
    const { events } = await stored(id);
    expect(JSON.stringify(events)).not.toContain("203.0.113.9");
  });

  it("are stored when a study turns that on", async () => {
    const slug = uniqueSlug();
    await importStudy(slug, { privacy: "privacy: { storeIpAddress: true }" });
    const id = `ip-${slug}`;

    await enter(slug, id);

    expect((await stored(id)).events[0]?.payload).toMatchObject({ ipAddress: "203.0.113.9" });
  });
});
