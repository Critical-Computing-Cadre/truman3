import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { setUpTeam } from "@truman3/accounts";
import { createApp } from "@truman3/api/app";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { trumanClient } from "./client.ts";
import { createTrumanServer } from "./server.ts";

/** The MCP server, used the way an MCP client would, against the real API. ADR 64. */

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof createApp>;
const storage = createStorage(storageConfigFromEnv());

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
});

/** An MCP client connected to Truman's MCP server, with a new researcher's token. */
async function connected() {
  const id = randomUUID().slice(0, 8);
  const { teamId, password } = await setUpTeam(database.db, {
    teamName: `lab-${id}`,
    slug: `lab-${id}`,
    email: `${id}@example.edu`,
    name: "Owner",
  });
  const login = await app.request("/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${id}@example.edu`, password }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const made = await app.request("/admin/tokens", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: "Test agent" }),
  });
  const { token } = (await made.json()) as { token: string };

  const client = trumanClient({
    baseUrl: "http://truman.test",
    token,
    fetch: async (url, init) => app.request(new URL(url).pathname, init),
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createTrumanServer(client, "# The guide").connect(serverSide);
  const mcp = new Client({ name: "test", version: "1.0.0" });
  await mcp.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await mcp.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const text = result.content[0]?.text ?? "";
    return { isError: Boolean(result.isError), text, json: () => JSON.parse(text) };
  };
  return { teamId, mcp, call };
}

describe("Truman's MCP server", () => {
  it("lists its tools and serves the guide", async () => {
    const { mcp, call } = await connected();
    const { tools } = await mcp.listTools();
    expect(tools.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "guide",
        "list_studies",
        "start_study",
        "read_draft",
        "add_item",
        "write_page",
        "save_version",
        "run_scenarios",
        "simulate",
        "recommend_to_researcher",
      ]),
    );
    expect((await call("guide")).text).toBe("# The guide");
    const { contents } = await mcp.readResource({ uri: "truman://guide" });
    expect(contents[0] && "text" in contents[0] ? contents[0].text : null).toBe("# The guide");
  });

  it("builds a study, writes its beats and tests, saves it, and runs the tests", async () => {
    const { teamId, call } = await connected();
    const started = await call("start_study", {
      teamId,
      title: "From an agent",
      slug: `agent-${randomUUID().slice(0, 8)}`,
      assignment: "uniform",
      template: "classic",
    });
    expect(started.isError).toBe(false);
    const { draftId } = started.json() as { draftId: string };

    const ann = await call("add_item", {
      draftId,
      kind: "actor",
      fields: { username: "ann", name: "Ann" },
    });
    expect(ann.isError).toBe(false);
    const beats = await call("write_page", {
      draftId,
      page: "beats.yaml",
      text: `beats:
  - { id: hello, when: { time: "0:01" }, do: { action: post, actor: ann, text: Hello from Ann } }
`,
    });
    expect(beats.isError).toBe(false);
    const tests = await call("write_page", {
      draftId,
      page: "scenarios.yaml",
      text: `scenarios:
  - name: Ann says hello
    condition: control
    steps: [{ at: "0:02", expect: { happened: [hello], sees: [Hello from Ann] } }]
`,
    });
    expect(tests.isError).toBe(false);

    const read = (await call("read_draft", { draftId })).json() as {
      settings: { pages: Record<string, { text: string }> };
    };
    expect(read.settings.pages["beats.yaml"]?.text).toContain("Hello from Ann");

    const saved = await call("save_version", { draftId });
    expect(saved.isError).toBe(false);
    const { versionId } = saved.json() as { versionId: string };
    const ran = (await call("run_scenarios", { versionId })).json() as {
      latest: { status: string };
    };
    expect(ran.latest.status).toBe("passed");
  });

  it("says plainly when something is for the researcher, and can recommend it", async () => {
    const { call } = await connected();
    const refused = await call("call_api", {
      method: "POST",
      path: `/admin/versions/${randomUUID()}/launch`,
      body: {},
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("recommend it");
    const outside = await call("call_api", { method: "GET", path: "/health" });
    expect(outside.isError).toBe(true);

    const recommended = await call("recommend_to_researcher", {
      action: "Launch version 1 of From an agent",
      why: "Its scenario tests pass, and a simulation found nothing to look at.",
    });
    expect(recommended.text).toContain("who does this themselves");
  });
});
