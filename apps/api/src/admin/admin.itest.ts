import { randomUUID } from "node:crypto";
import { setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import type { Storage } from "@truman3/storage";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppDependencies, createApp } from "../app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;

function makeApp(overrides: Partial<AppDependencies> = {}) {
  return createApp({
    pingDatabase: database.ping,
    db: database.db,
    storage: {} as Storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => "203.0.113.1",
    secureCookies: true,
    ...overrides,
  });
}

/** A team with one owner, and a study of its own. */
async function team() {
  const slug = `lab-${randomUUID().slice(0, 8)}`;
  const email = `${slug}@example.edu`;
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: slug,
    slug,
    email,
    name: "Owner",
  });
  const [study] = await database.db
    .insert(schema.studies)
    .values({ slug: `study-${slug}`, teamId })
    .returning();
  return { email, password: password as string, teamId, study: study! };
}

function login(email: string, password: string, on = app) {
  return on.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

async function signIn(email: string, password: string) {
  const response = await login(email, password);
  expect(response.status).toBe(200);
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

beforeAll(async () => {
  database = await createTestDatabase();
  app = makeApp();
});

afterAll(async () => {
  await database.destroy();
});

describe("signing in", () => {
  it("works with the right password, setting a protected cookie", async () => {
    const { email, password } = await team();

    const response = await login(email, password);
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("ignores capitals in the email", async () => {
    const { email, password } = await team();
    expect((await login(email.toUpperCase(), password)).status).toBe(200);
  });

  it("says the same thing for a wrong password and an unknown email", async () => {
    const { email } = await team();

    const wrong = await login(email, "wrong");
    const unknown = await login("nobody@example.edu", "wrong");

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("is limited when there are too many attempts", async () => {
    const { email, password } = await team();
    const limited = makeApp({ allowLoginAttempt: () => false });

    expect((await login(email, password, limited)).status).toBe(429);
  });

  it("ends with signing out, and that session stops working", async () => {
    const { email, password } = await team();
    const cookie = await signIn(email, password);

    await app.request("/admin/logout", { method: "POST", headers: { cookie } });

    expect((await app.request("/admin/me", { headers: { cookie } })).status).toBe(401);
  });

  it("stops working when the session expires", async () => {
    const { email, password } = await team();
    const cookie = await signIn(email, password);
    await database.db
      .update(schema.researcherSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.researcherSessions.tokenHash, schema.researcherSessions.tokenHash));

    expect((await app.request("/admin/me", { headers: { cookie } })).status).toBe(401);
  });

  it("never returns the password hash", async () => {
    const { email, password } = await team();
    const cookie = await signIn(email, password);

    const text = await (await app.request("/admin/me", { headers: { cookie } })).text();

    expect(text).toContain(email);
    expect(text).not.toContain("scrypt");
  });
});

describe("what a researcher can see", () => {
  it("requires signing in", async () => {
    expect((await app.request("/admin/studies")).status).toBe(401);
  });

  it("doesn't accept a participant's session", async () => {
    const response = await app.request("/admin/studies", {
      headers: { cookie: "session=whatever" },
    });
    expect(response.status).toBe(401);
  });

  it("lists their own team's studies and not another team's", async () => {
    const mine = await team();
    const theirs = await team();
    const cookie = await signIn(mine.email, mine.password);

    const response = await app.request("/admin/studies", { headers: { cookie } });
    const { studies } = (await response.json()) as { studies: { id: string }[] };

    expect(studies.map(({ id }) => id)).toEqual([mine.study.id]);
    expect(studies.map(({ id }) => id)).not.toContain(theirs.study.id);
  });
});

describe("setting up a team", () => {
  it("adopts studies with no team, so an existing lab's studies aren't lost", async () => {
    const [orphan] = await database.db
      .insert(schema.studies)
      .values({ slug: `orphan-${randomUUID().slice(0, 8)}` })
      .returning();

    const { teamId, studiesAdopted } = await setUpTeam(database.db, {
      teamName: "Lab",
      slug: `lab-${randomUUID().slice(0, 8)}`,
      email: `new-${randomUUID().slice(0, 8)}@example.edu`,
      name: "Owner",
    });

    expect(studiesAdopted).toBeGreaterThanOrEqual(1);
    const [study] = await database.db
      .select()
      .from(schema.studies)
      .where(eq(schema.studies.id, orphan!.id));
    expect(study?.teamId).toBe(teamId);
  });
});
