import { randomBytes } from "node:crypto";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import { AGENT_TOOLS, GUIDE, trumanClient } from "@truman3/agent-tools";
import { type Database, schema } from "@truman3/db";
import type { AgentStep, Writer } from "@truman3/writer";
import { desc, eq } from "drizzle-orm";
import { whyNoModel, writerFor } from "../ai.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { hashSessionToken } from "../participants/session.ts";
import { researcherFromRequest, TOKEN_PREFIX } from "./session.ts";

/**
 * "Draft from a brief": an agent on the server works on a draft for a researcher, with the same
 * tools as the MCP server and the same limits, since it uses a token made for the run and revoked
 * when it ends. It can draft a whole study from a brief, or do one job on a draft, like writing
 * personas or scenario tests. What it writes is marked as generated. See ADR 65.
 */

/** The model, which should be good at a long job with many steps. */
export const AGENT_MODEL = "claude-opus-5-5";
export const DEFAULT_BUDGET_USD = 2;
const MAX_BUDGET_USD = 20;
/** Enough model calls to draft a whole study, and check it. */
const MAX_STEPS = 60;
/** A run still "running" after this was stopped by the server, and doesn't block another. */
const STALE_MS = 3 * 60 * 60 * 1000;
/** Steps kept for the researcher to read, newest last. */
const MAX_STEPS_KEPT = 200;

const stepSchema = z.object({
  tool: z.string().optional(),
  text: z.string(),
  error: z.boolean().optional(),
});
const runSchema = z.object({
  id: z.string(),
  brief: z.string(),
  status: z.enum(["running", "done", "error"]),
  model: z.string(),
  budgetUsd: z.number(),
  costUsd: z.number(),
  steps: z.array(stepSchema),
  summary: z.string().nullable(),
  stopped: z.string().nullable(),
  startedBy: z.string(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const draftParams = z.object({ draftId: z.uuid() });

const listRoute = createRoute({
  method: "get",
  path: "/admin/drafts/{draftId}/agent",
  summary: "Agent runs on this draft, newest first, and whether the server can run one",
  request: { params: draftParams },
  responses: {
    200: {
      description: "Runs",
      content: {
        "application/json": {
          schema: z.object({
            canRun: z.boolean(),
            /** Why this lab can't use a model now, or null if it can (ADR 71). */
            noModel: z.string().nullable(),
            model: z.string(),
            defaultBudgetUsd: z.number(),
            runs: z.array(runSchema),
          }),
        },
      },
    },
    401: errorResponse("Not signed in"),
    404: errorResponse("No such draft for this researcher"),
  },
});

const startRoute = createRoute({
  method: "post",
  path: "/admin/drafts/{draftId}/agent",
  summary: "Ask an agent to work on this draft: draft a study from a brief, or one job on it",
  request: {
    params: draftParams,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            brief: z.string().trim().min(10).max(8000),
            budgetUsd: z.number().positive().max(MAX_BUDGET_USD).default(DEFAULT_BUDGET_USD),
          }),
        },
      },
    },
  },
  responses: {
    202: {
      description: "Started. It works in the background; check back for its steps",
      content: { "application/json": { schema: z.object({ id: z.string() }) } },
    },
    400: errorResponse("The server has no Claude key"),
    401: errorResponse("Not signed in"),
    403: errorResponse("This researcher can only view this study"),
    404: errorResponse("No such draft for this researcher"),
    409: errorResponse("An agent is already working on this draft"),
  },
});

type Run = typeof schema.agentRuns.$inferSelect;
const toJson = (run: Run, startedBy: string) => ({
  id: run.id,
  brief: run.brief,
  status: run.status,
  model: run.model,
  budgetUsd: run.budgetUsd,
  costUsd: run.costUsd,
  steps: run.steps as AgentStep[],
  summary: run.summary,
  stopped: run.stopped,
  startedBy,
  startedAt: run.startedAt.toISOString(),
  finishedAt: run.finishedAt?.toISOString() ?? null,
});

/** What the agent is told, around the researcher's brief. */
function instructions(draftId: string, studyTitle: string) {
  return `You're working in Truman for a researcher, on the draft of their study "${studyTitle}" (draftId ${draftId}). Use the tools to do what they ask, in that draft. Read the draft first. Check your work as you go: read the draft's problems after changes, and when it's ready, save a version, run its scenario tests, and simulate it at random. Fix what you find. Don't launch anything: if that, or anything else only the researcher can do, is the right next step, recommend it with recommend_to_researcher.

When you're done, end with a short summary for the researcher: what you added or changed, what you checked and how it went, and what you recommend they do or look at.

Here's the guide to Truman:

${GUIDE}`;
}

/**
 * Runs the agent on a draft, in the background. It uses a token made for this run, so the server's
 * limits on agents apply, and revokes it when done.
 */
async function runAgent({
  db,
  writer,
  selfRequest,
  run,
  researcherId,
  studyTitle,
}: {
  db: Database;
  writer: Writer;
  selfRequest: (path: string, init?: RequestInit) => Response | Promise<Response>;
  run: Run;
  researcherId: string;
  studyTitle: string;
}) {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const [made] = await db
    .insert(schema.researcherTokens)
    .values({
      researcherId,
      name: `Draft from a brief (${run.id.slice(-6)})`,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    })
    .returning({ id: schema.researcherTokens.id });
  const client = trumanClient({
    baseUrl: "http://truman.internal",
    token,
    // This process's own API, which serves the admin API without the /api in front.
    fetch: async (url, init) => {
      const { pathname, search } = new URL(url);
      return selfRequest(pathname.replace(/^\/api(?=\/)/, "") + search, init);
    },
  });
  const steps: AgentStep[] = [];
  const record = (values: Partial<typeof schema.agentRuns.$inferInsert>) =>
    db.update(schema.agentRuns).set(values).where(eq(schema.agentRuns.id, run.id));
  try {
    // The study's lab's key, or the host's within its starter budget (ADR 71).
    const model = (await writerFor(writer, { draftId: run.draftId })) as Writer;
    const result = await model.runAgent({
      model: run.model,
      system: instructions(run.draftId, studyTitle),
      prompt: run.brief,
      budgetUsd: run.budgetUsd,
      maxSteps: MAX_STEPS,
      tools: AGENT_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input: tool.input,
        run: async (input) => {
          const value = await tool.run(client, input as never);
          return typeof value === "string" ? value : JSON.stringify(value);
        },
      })),
      onStep: async (step, spentUsd) => {
        steps.push(step);
        await record({ steps: steps.slice(-MAX_STEPS_KEPT), costUsd: spentUsd });
      },
    });
    await record({
      status: "done",
      steps: steps.slice(-MAX_STEPS_KEPT),
      costUsd: result.costUsd,
      summary: result.summary,
      stopped: result.stopped,
      model: result.model,
      finishedAt: new Date(),
    });
  } catch (error) {
    console.error("An agent run failed:", error instanceof Error ? error.message : error);
    await record({
      status: "error",
      steps: steps.slice(-MAX_STEPS_KEPT),
      summary: "Something went wrong, so the agent stopped. What it did before that is above.",
      finishedAt: new Date(),
    });
  } finally {
    if (made) {
      await db
        .update(schema.researcherTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.researcherTokens.id, made.id));
    }
  }
}

export function createAgentRoutes({
  db,
  writer = null,
  selfRequest,
}: ParticipantRouteDependencies & {
  selfRequest: (path: string, init?: RequestInit) => Response | Promise<Response>;
}) {
  const app = new OpenAPIHono();

  /** The draft, its study, and whether this researcher can change it. */
  const access = async (researcherId: string, draftId: string) => {
    const [draft] = await db
      .select({
        id: schema.studyDrafts.id,
        studyId: schema.studyDrafts.studyId,
        settings: schema.studyDrafts.settings,
      })
      .from(schema.studyDrafts)
      .where(eq(schema.studyDrafts.id, draftId));
    const role = draft ? await roleOnStudy(db, researcherId, draft.studyId) : null;
    return draft && role ? { draft, canEdit: role !== "viewer" } : null;
  };

  app.openapi(listRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json({ error: "Please sign in." }, 401);
    }
    const { draftId } = c.req.valid("param");
    if (!(await access(researcher.id, draftId))) {
      return c.json({ error: "That isn't available." }, 404);
    }
    const rows = await db
      .select({ run: schema.agentRuns, name: schema.researchers.name })
      .from(schema.agentRuns)
      .innerJoin(schema.researchers, eq(schema.researchers.id, schema.agentRuns.startedBy))
      .where(eq(schema.agentRuns.draftId, draftId))
      .orderBy(desc(schema.agentRuns.startedAt))
      .limit(10);
    const noModel = await whyNoModel(writer, { draftId });
    return c.json(
      {
        canRun: noModel === null,
        noModel,
        model: AGENT_MODEL,
        defaultBudgetUsd: DEFAULT_BUDGET_USD,
        runs: rows.map(({ run, name }) => toJson(run, name)),
      },
      200,
    );
  });

  app.openapi(startRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json({ error: "Please sign in." }, 401);
    }
    // An agent can't start another agent with its token.
    if (researcher.token) {
      return c.json({ error: "An agent can't start another agent." }, 403);
    }
    const { draftId } = c.req.valid("param");
    const found = await access(researcher.id, draftId);
    if (!found) {
      return c.json({ error: "That isn't available." }, 404);
    }
    if (!found.canEdit) {
      return c.json({ error: "You can only view this study." }, 403);
    }
    const noModel = await whyNoModel(writer, { draftId });
    if (!writer || noModel) {
      return c.json({ error: noModel ?? "An agent needs a Claude key." }, 400);
    }
    const { brief, budgetUsd } = c.req.valid("json");
    const [busy] = await db
      .select({ id: schema.agentRuns.id })
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.draftId, draftId))
      .orderBy(desc(schema.agentRuns.startedAt))
      .limit(1);
    const [latest] = busy
      ? await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, busy.id))
      : [];
    // A run the server stopped partway through, say for a deploy, doesn't block a new one for long.
    const stale = latest && Date.now() - latest.startedAt.getTime() > STALE_MS;
    if (latest?.status === "running" && !stale) {
      return c.json({ error: "An agent is already working on this draft." }, 409);
    }
    const [run] = await db
      .insert(schema.agentRuns)
      .values({
        draftId,
        brief,
        status: "running",
        model: AGENT_MODEL,
        budgetUsd,
        startedBy: researcher.id,
      })
      .returning();
    if (!run) {
      throw new Error("The run wasn't saved.");
    }
    const studyTitle = (found.draft.settings as { title?: string }).title ?? "Untitled";
    void runAgent({ db, writer, selfRequest, run, researcherId: researcher.id, studyTitle });
    return c.json({ id: run.id }, 202);
  });

  return app;
}
