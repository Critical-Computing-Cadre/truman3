import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TrumanClient } from "./client.ts";

/**
 * Truman's MCP server: tools for an agent to help a researcher build and check studies, through
 * the admin API with their personal access token. Anything that reaches real participants is for
 * the researcher to do, and the server refuses it from a token. An agent recommends it instead,
 * with recommend_to_researcher. See ADR 64 and docs/guides/for-agents.md.
 */

/** How long to wait for scenario tests or a simulation before saying it's still going. */
const WAIT_MS = 5 * 60_000;
const CHECK_EVERY_MS = 2_000;

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const json = (value: unknown): Result => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

/** Runs a tool, turning a refusal or a problem into a message the agent can act on. */
async function run(work: () => Promise<unknown>): Promise<Result> {
  try {
    return json(await work());
  } catch (error) {
    return {
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until a background run finishes, or gives up and says to check again. */
async function waitFor<T extends { latest?: { status: string } | null }>(
  check: () => Promise<T>,
  running: string,
): Promise<T | { stillRunning: true; message: string }> {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    const state = await check();
    if (state.latest?.status !== running) {
      return state;
    }
    if (Date.now() > until) {
      return { stillRunning: true, message: "It's still running. Check again in a minute." };
    }
    await sleep(CHECK_EVERY_MS);
  }
}

export function createTrumanServer(client: TrumanClient, guide: string): McpServer {
  const server = new McpServer({ name: "truman", version: "0.1.0" });

  server.registerResource(
    "guide",
    "truman://guide",
    {
      title: "How to work in Truman",
      description: "What Truman is, how a study is put together, and what an agent may do.",
      mimeType: "text/markdown",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide }] }),
  );

  server.registerTool(
    "guide",
    {
      title: "Read the guide",
      description:
        "Read this first. How Truman studies are built, the files and their formats, and what you may and may not do for the researcher.",
    },
    async () => ({ content: [{ type: "text", text: guide }] }),
  );

  server.registerTool(
    "list_studies",
    {
      title: "List studies",
      description:
        "The researcher's studies, with their versions, drafts, and whether each is open to participants.",
    },
    () => run(() => client.call("GET", "/admin/studies")),
  );

  server.registerTool(
    "list_packs",
    {
      title: "List content packs",
      description: "Content packs a new study can start from: posts, people, and beats to copy.",
    },
    () => run(() => client.call("GET", "/admin/packs")),
  );

  server.registerTool(
    "start_study",
    {
      title: "Start a study",
      description:
        "Start a new study, with a draft to write in, from nothing or from a content pack. The researcher's team id is in list_studies.",
      inputSchema: {
        teamId: z.string(),
        title: z.string(),
        slug: z.string().describe("The study's link name: lowercase letters, numbers, and dashes."),
        assignment: z.enum(["uniform", "blocked"]),
        packId: z.string().nullable().default(null),
        template: z.string().optional().describe("classic, forum, shortPosts, or photo"),
      },
    },
    (input) => run(() => client.call("POST", "/admin/studies", input)),
  );

  server.registerTool(
    "open_draft",
    {
      title: "Open a draft",
      description:
        "Open the study's draft to change it, starting one from this saved version if there isn't one.",
      inputSchema: { versionId: z.string() },
    },
    ({ versionId }) => run(() => client.call("POST", `/admin/versions/${versionId}/draft`, {})),
  );

  server.registerTool(
    "read_draft",
    {
      title: "Read a draft",
      description:
        "Everything in a draft: its people, posts, comments, and moderation, its settings and pages (beats.yaml, scenarios.yaml, personas.yaml, consent), and any problems found when checking it.",
      inputSchema: { draftId: z.string() },
    },
    ({ draftId }) =>
      run(async () => ({
        draft: await client.call("GET", `/admin/drafts/${draftId}`),
        settings: await client.call("GET", `/admin/drafts/${draftId}/settings`),
      })),
  );

  server.registerTool(
    "add_item",
    {
      title: "Add to a draft",
      description:
        "Add a person in the cast (kind actor), a post, a comment, a space, or a moderator's decision. It's marked as generated by an agent.",
      inputSchema: {
        draftId: z.string(),
        kind: z.string(),
        fields: z.record(z.string(), z.unknown()),
      },
    },
    ({ draftId, kind, fields }) =>
      run(() => client.call("POST", `/admin/drafts/${draftId}/items`, { kind, fields })),
  );

  server.registerTool(
    "change_item",
    {
      title: "Change something in a draft",
      description: "Change some fields of an item in a draft, by its id.",
      inputSchema: {
        draftId: z.string(),
        itemId: z.string(),
        fields: z.record(z.string(), z.unknown()),
      },
    },
    ({ draftId, itemId, fields }) =>
      run(() => client.call("PATCH", `/admin/drafts/${draftId}/items/${itemId}`, { fields })),
  );

  server.registerTool(
    "remove_item",
    {
      title: "Remove something from a draft",
      description: "Remove an item from a draft, by its id. Comments on a post go with it.",
      inputSchema: { draftId: z.string(), itemId: z.string() },
    },
    ({ draftId, itemId }) =>
      run(() => client.call("DELETE", `/admin/drafts/${draftId}/items/${itemId}`)),
  );

  /** Saves a section or page, from the revision it's at now. */
  const save = async (draftId: string, section: string, value: unknown) => {
    const settings = await client.call<{
      sections: Record<string, { revision: number }>;
      pages: Record<string, { revision: number }>;
    }>("GET", `/admin/drafts/${draftId}/settings`);
    const page = section.startsWith("page:") ? section.slice("page:".length) : null;
    const baseRevision =
      (page ? settings.pages[page]?.revision : settings.sections?.[section]?.revision) ?? 0;
    return client.call("PUT", `/admin/drafts/${draftId}/settings`, {
      section,
      value,
      baseRevision,
    });
  };

  server.registerTool(
    "write_page",
    {
      title: "Write a page",
      description:
        "Write one of a draft's files in full: beats.yaml (what the cast does), scenarios.yaml (tests), personas.yaml (simulated participants), or a page like pages/rules.md. It's checked as it's saved.",
      inputSchema: { draftId: z.string(), page: z.string(), text: z.string() },
    },
    ({ draftId, page, text }) => run(() => save(draftId, `page:${page}`, text)),
  );

  server.registerTool(
    "save_settings",
    {
      title: "Save settings",
      description:
        "Save one section of a draft's settings: study (title, site, platform), conditions, feed, or flow. Give the whole section, as read_draft shows it.",
      inputSchema: {
        draftId: z.string(),
        section: z.enum(["study", "conditions", "feed", "flow"]),
        value: z.record(z.string(), z.unknown()),
      },
    },
    ({ draftId, section, value }) => run(() => save(draftId, section, value)),
  );

  server.registerTool(
    "save_version",
    {
      title: "Save a version",
      description:
        "Save the draft as a new version, so it can be tested and simulated. Participants don't get it until the researcher launches it.",
      inputSchema: { draftId: z.string() },
    },
    ({ draftId }) => run(() => client.call("POST", `/admin/drafts/${draftId}/freeze`, {})),
  );

  server.registerTool(
    "run_scenarios",
    {
      title: "Run scenario tests",
      description:
        "Run a saved version's scenario tests, from its scenarios.yaml, and wait for the results.",
      inputSchema: { versionId: z.string() },
    },
    ({ versionId }) =>
      run(async () => {
        const path = `/admin/versions/${versionId}/scenarios`;
        await client.call("POST", path, {});
        return waitFor(() => client.call<{ latest?: { status: string } }>("GET", path), "running");
      }),
  );

  server.registerTool(
    "simulate",
    {
      title: "Simulate participants",
      description:
        "Send simulated participants through a saved version and wait for the report. At random costs nothing. With personas (ids from personas.yaml), a model plays them, up to budgetUsd.",
      inputSchema: {
        versionId: z.string(),
        participants: z.number().int().min(1).max(200).default(50),
        seed: z.number().int().nonnegative().optional(),
        personas: z.array(z.string()).optional(),
        budgetUsd: z.number().positive().max(100).optional(),
      },
    },
    ({ versionId, ...settings }) =>
      run(async () => {
        const path = `/admin/versions/${versionId}/simulations`;
        await client.call("POST", path, settings);
        return waitFor(() => client.call<{ latest?: { status: string } }>("GET", path), "running");
      }),
  );

  server.registerTool(
    "monitor",
    {
      title: "How a study is going",
      description:
        "A running study's counts: how many joined, finished, and what they did, by condition. No one's own data.",
      inputSchema: { studyId: z.string() },
    },
    ({ studyId }) => run(() => client.call("GET", `/admin/studies/${studyId}/monitor`)),
  );

  server.registerTool(
    "call_api",
    {
      title: "Call the admin API",
      description:
        "Anything else in the admin API, under /admin/. The full list is at /api/openapi.json on the server. What reaches real participants is refused.",
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        path: z.string().describe("Like /admin/drafts/<id>/preview"),
        body: z.unknown().optional(),
      },
    },
    ({ method, path, body }) => run(() => client.call(method, path, body)),
  );

  server.registerTool(
    "recommend_to_researcher",
    {
      title: "Recommend something only the researcher can do",
      description:
        "Launching, stopping, or deleting a study, withdrawing someone, downloading real data, Prolific, and approving what the cast says to participants are for the researcher, in the admin app. Use this to recommend one, with why. It does nothing itself.",
      inputSchema: {
        action: z.string().describe("What to do, like 'Launch version 3 of Bystander'"),
        why: z.string(),
        where: z.string().optional().describe("Where in the admin app, like 'the Studies page'"),
      },
    },
    async ({ action, why, where }) => ({
      content: [
        {
          type: "text",
          text: `Recommendation for the researcher, who does this themselves${where ? ` on ${where}` : " in the admin app"}:\n\n${action}\n\nWhy: ${why}`,
        },
      ],
    }),
  );

  return server;
}
