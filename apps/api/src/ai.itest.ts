import { randomBytes, randomUUID } from "node:crypto";
import { addResearcherToTeam, setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { NothingWritten, type Writer } from "@truman3/writer";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAi, writerFor } from "./ai.ts";
import { createApp } from "./app.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const storage = createStorage(storageConfigFromEnv());
const SECRET = randomBytes(32);
const COST = 0.03;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  storage.close();
  await database.destroy();
});

/** A writer that writes nothing real, and says who it is, so a test can tell which key was used. */
function fakeWriter(who: string): Writer {
  const result = { model: who, costUsd: COST };
  return {
    write: async () => ({ ...result, text: who }),
    check: async () => ({ ...result, allowed: true, reason: "" }),
    choose: async () => ({ ...result, choice: 0, text: who }),
    rehearse: async () => ({ ...result, lines: [who] }),
    act: async () => ({ ...result, why: "", action: "nothing", item: null, text: "" }),
    runAgent: async (request: { budgetUsd: number }) => ({
      ...result,
      costUsd: Math.min(COST, request.budgetUsd),
      summary: who,
      stopped: "done",
      steps: [],
    }),
  } as unknown as Writer;
}

const host = fakeWriter("host");
const labKeys: string[] = [];
const labWriter = (apiKey: string) => {
  labKeys.push(apiKey);
  return fakeWriter("lab");
};

/** A team, with a status and limits, and a study of its own. */
async function team(status: "pending" | "approved", limits: object = {}) {
  const id = randomUUID().slice(0, 8);
  const made = await setUpTeam(database.db, {
    teamName: `Lab ${id}`,
    slug: `lab-${id}`,
    email: `${id}@example.edu`,
    name: "Owner",
  });
  await database.db
    .update(schema.teams)
    .set({ status, limits })
    .where(eq(schema.teams.id, made.teamId));
  const [study] = await database.db
    .insert(schema.studies)
    .values({ slug: `ai-${id}`, teamId: made.teamId })
    .returning({ id: schema.studies.id });
  return { ...made, id, email: `${id}@example.edu`, studyId: study?.id as string };
}

const spending = (teamId: string) =>
  database.db.select().from(schema.aiSpending).where(eq(schema.aiSpending.teamId, teamId));

const ask = (writer: Writer) => writer.write({ model: "m", system: "", prompt: "", maxLength: 50 });

describe("whose Claude key pays (ADR 71)", () => {
  it("lets an approved lab use the host's key up to its starter budget, and records each call", async () => {
    const ai = createAi({ db: database.db, host, hosted: true, secretKey: SECRET });
    const lab = await team("approved", { starterBudgetUsd: 0.05 });

    expect((await ask((await writerFor(ai, { studyId: lab.studyId })) as Writer)).text).toBe(
      "host",
    );
    expect((await ask((await writerFor(ai, { studyId: lab.studyId })) as Writer)).text).toBe(
      "host",
    );
    // $0.06 spent of $0.05, so the next one is refused, saying why.
    const third = ask((await writerFor(ai, { studyId: lab.studyId })) as Writer);
    await expect(third).rejects.toBeInstanceOf(NothingWritten);
    await expect(third).rejects.toThrow(/starter budget of \$0.05 is used up/);

    const rows = await spending(lab.teamId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.paidBy === "host" && row.studyId === lab.studyId)).toBe(true);
  });

  it("uses a lab's own key once it has one, and charges it to the lab", async () => {
    const app = createApp({
      pingDatabase: database.ping,
      db: database.db,
      storage,
      mediaPublicUrl: "http://media.test",
      getClientIp: () => undefined,
      secureCookies: false,
      hosted: true,
      secretKey: SECRET.toString("base64"),
    });
    const lab = await team("approved", { starterBudgetUsd: 0 });
    const login = await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: lab.email, password: lab.password }),
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const put = (key: string, who = cookie) =>
      app.request(`/admin/teams/${lab.teamId}/ai`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: who },
        body: JSON.stringify({ key }),
      });

    expect((await put("not-a-claude-key-at-all-really")).status).toBe(400);
    const apiKey = `sk-ant-test-${randomUUID()}`;
    const stored = await put(apiKey);
    expect(stored.status).toBe(200);
    const shown = await stored.json();
    expect(shown).toMatchObject({ canStore: true, keyHint: `…${apiKey.slice(-4)}` });
    expect(JSON.stringify(shown)).not.toContain(apiKey);
    // Kept encrypted, so a copy of the database alone doesn't give it away.
    const [row] = await database.db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.id, lab.teamId));
    expect(row?.anthropicKeyEncrypted).not.toContain(apiKey);

    const ai = createAi({
      db: database.db,
      host,
      hosted: true,
      secretKey: SECRET,
      writerForKey: labWriter,
    });
    // Its starter budget is $0, but its own key has no limit here.
    expect((await ask((await writerFor(ai, { studyId: lab.studyId })) as Writer)).text).toBe("lab");
    expect(labKeys).toContain(apiKey);
    expect((await spending(lab.teamId)).map(({ paidBy }) => paidBy)).toEqual(["lab"]);

    // An editor can't change it, but an owner can remove it.
    const editor = await addResearcherToTeam(database.db, {
      teamSlug: `lab-${lab.id}`,
      email: `editor-${lab.id}@example.edu`,
      name: "Editor",
      role: "editor",
    });
    const editorLogin = await app.request("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `editor-${lab.id}@example.edu`, password: editor.password }),
    });
    const editorCookie = (editorLogin.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect((await put(`sk-ant-other-${randomUUID()}`, editorCookie)).status).toBe(403);
    const removed = await app.request(`/admin/teams/${lab.teamId}/ai`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(await removed.json()).toMatchObject({ keyHint: null, labUsd: COST });
  });

  it("gives a lab waiting for approval no use of the host's key", async () => {
    const ai = createAi({ db: database.db, host, hosted: true, secretKey: SECRET });
    const lab = await team("pending");
    await expect(ask((await writerFor(ai, { studyId: lab.studyId })) as Writer)).rejects.toThrow(
      /isn't approved yet/,
    );
  });

  it("keeps an agent on the starter budget to what's left of it", async () => {
    const ai = createAi({ db: database.db, host, hosted: true, secretKey: SECRET });
    const lab = await team("approved", { starterBudgetUsd: 0.01 });
    const writer = (await writerFor(ai, { studyId: lab.studyId })) as Writer;
    const run = await writer.runAgent({
      model: "m",
      system: "",
      prompt: "",
      tools: [],
      budgetUsd: 5,
      maxSteps: 3,
    });
    expect(run.costUsd).toBe(0.01);
  });

  it("on a Truman that isn't hosted, uses the host's key for everyone, and still counts it", async () => {
    const ai = createAi({ db: database.db, host, hosted: false, secretKey: SECRET });
    const lab = await team("approved", {});
    expect((await ask((await writerFor(ai, { studyId: lab.studyId })) as Writer)).text).toBe(
      "host",
    );
    expect(await spending(lab.teamId)).toHaveLength(1);
    expect(createAi({ db: database.db, host: null, hosted: false, secretKey: SECRET })).toBeNull();
  });
});
