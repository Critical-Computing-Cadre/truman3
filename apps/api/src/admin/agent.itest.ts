import { randomUUID } from "node:crypto";
import { setUpTeam } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { type AgentRequest, standInWriter, type Writer } from "@truman3/writer";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

/**
 * "Draft from a brief" (ADR 65), with a scripted agent in place of a model: it uses the real tools,
 * through the real API, with a token made for the run.
 */

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
let appWithoutModel: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());
const asked: AgentRequest[] = [];

/** Adds Ann, writes a beat, then tries to launch, which an agent can't do. */
const writer: Writer = {
  ...standInWriter(),
  async runAgent(request) {
    asked.push(request);
    const draftId = /draftId ([0-9a-f-]{36})/.exec(request.system)?.[1] as string;
    const use = async (name: string, input: unknown) => {
      const tool = request.tools.find((each) => each.name === name);
      try {
        const text = (await tool?.run(input)) ?? "";
        await request.onStep?.({ tool: name, input, text }, 0.1);
      } catch (error) {
        await request.onStep?.({ tool: name, input, text: String(error), error: true }, 0.1);
      }
    };
    await use("read_draft", { draftId });
    await use("add_item", { draftId, kind: "actor", fields: { username: "ann", name: "Ann" } });
    await use("write_page", {
      draftId,
      page: "beats.yaml",
      text: 'beats:\n  - { id: hi, when: { time: "0:01" }, do: { action: post, actor: ann, text: Hi } }\n',
    });
    await use("call_api", { method: "POST", path: `/admin/versions/${randomUUID()}/launch` });
    return {
      summary: "I added Ann and a beat. Launch it when you're ready.",
      model: "stand-in",
      costUsd: 0.4,
      stopped: "done",
    };
  },
};

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
  const base = {
    pingDatabase: database.ping,
    db: database.db,
    storage,
    mediaPublicUrl: "http://media.test",
    getClientIp: () => undefined,
    secureCookies: false,
  };
  app = createApp({ ...base, writer });
  appWithoutModel = createApp(base);
});

afterAll(async () => {
  storage.close();
  await database.destroy();
});

async function researcherWithDraft(on = app) {
  const id = randomUUID().slice(0, 8);
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email: `${id}@example.edu`,
    name: "Owner",
  });
  const login = await on.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${id}@example.edu`, password }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const call = (method: string, url: string, body?: object, headers: object = { cookie }) =>
    on.request(url, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const started = await call("POST", "/admin/studies", {
    teamId,
    title: "Bystanders",
    slug: `brief-${id}`,
    assignment: "uniform",
    packId: null,
  });
  const { draftId } = (await started.json()) as { draftId: string };
  return { call, draftId };
}

type Runs = {
  canRun: boolean;
  runs: {
    status: string;
    steps: { tool?: string; error?: boolean; text: string }[];
    summary: string | null;
    costUsd: number;
  }[];
};

describe("Draft from a brief", () => {
  it("works on the draft with the tools, marks what it wrote, and can't launch", async () => {
    const { call, draftId } = await researcherWithDraft();
    const started = await call("POST", `/admin/drafts/${draftId}/agent`, {
      brief: "A bystander study where someone mocks a painting, in two conditions.",
    });
    expect(started.status).toBe(202);

    let state: Runs | null = null;
    for (let tries = 0; tries < 50; tries++) {
      state = (await (await call("GET", `/admin/drafts/${draftId}/agent`)).json()) as Runs;
      if (state.runs[0]?.status !== "running") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const [run] = state?.runs ?? [];
    expect(run).toMatchObject({
      status: "done",
      summary: "I added Ann and a beat. Launch it when you're ready.",
      costUsd: 0.4,
    });
    expect(run?.steps.map(({ tool, error }) => [tool, Boolean(error)])).toEqual([
      ["read_draft", false],
      ["add_item", false],
      ["write_page", false],
      ["call_api", true],
    ]);
    expect(run?.steps[3]?.text).toContain("recommend it");

    // It was told the guide and the brief.
    expect(asked.at(-1)?.system).toContain("# Working in Truman");
    expect(asked.at(-1)?.prompt).toContain("mocks a painting");

    const items = await database.db
      .select({ provenance: schema.draftItems.provenance })
      .from(schema.draftItems)
      .where(eq(schema.draftItems.draftId, draftId));
    // Ann, and the page it wrote, are both marked as generated by the run's token.
    expect(items).toHaveLength(2);
    for (const { provenance } of items) {
      expect(provenance).toEqual({
        origin: "generated",
        detail: { by: "agent", token: expect.stringMatching(/^Draft from a brief/) },
      });
    }
    const settings = (await (await call("GET", `/admin/drafts/${draftId}/settings`)).json()) as {
      pages: Record<string, { text: string }>;
    };
    expect(settings.pages["beats.yaml"]?.text).toContain("actor: ann");

    // Its token was revoked when it finished.
    const tokens = await database.db.select().from(schema.researcherTokens);
    expect(tokens.filter(({ revokedAt }) => revokedAt === null)).toEqual([]);
  });

  it("needs a Claude key on the server, and a person to start it", async () => {
    const without = await researcherWithDraft(appWithoutModel);
    const listed = (await (
      await without.call("GET", `/admin/drafts/${without.draftId}/agent`)
    ).json()) as Runs;
    expect(listed.canRun).toBe(false);
    const refused = await without.call("POST", `/admin/drafts/${without.draftId}/agent`, {
      brief: "A bystander study with two conditions.",
    });
    expect(refused.status).toBe(400);

    const { call, draftId } = await researcherWithDraft();
    const made = (await (await call("POST", "/admin/tokens", { name: "Agent" })).json()) as {
      token: string;
    };
    const fromAgent = await call(
      "POST",
      `/admin/drafts/${draftId}/agent`,
      { brief: "Start another agent please." },
      { authorization: `Bearer ${made.token}` },
    );
    expect(fromAgent.status).toBe(403);
  });
});
