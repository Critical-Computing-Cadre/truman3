import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import { PERSONAS_FILE } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import { parsePersonas } from "@truman3/study-files";
import type { Writer } from "@truman3/writer";
import { and, desc, eq, gt } from "drizzle-orm";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import {
  findings,
  MAX_SIMULATED,
  type SimulationReport,
  type SimulationSettings,
  simulate,
} from "../scenarios/simulate.ts";
import { researcherFromRequest } from "./session.ts";

/**
 * Simulated participants, run on the server for a saved version from a button, in the background.
 * Like scenario tests, the participants are deleted after each run, and only the report is kept.
 * See ADR 59.
 */

/** A run that's been going this long is taken to have stopped, such as in a restart. */
const STALE_MS = 30 * 60_000;

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const counts = z.record(z.string(), z.number());

const reportSchema = z.object({
  participants: z.number(),
  conditions: counts,
  actions: z.record(z.string(), z.object({ done: z.number(), refused: z.number() })),
  beats: z.array(
    z.object({
      id: z.string(),
      conditions: z.array(z.string()),
      happenedFor: counts,
      times: z.number(),
      mostForOne: z.number(),
      skipped: counts,
      stillDue: z.number(),
    }),
  ),
  decisions: z.array(z.object({ id: z.string(), reached: z.number(), to: counts, groups: counts })),
  problems: z.array(z.object({ text: z.string(), count: z.number(), participant: z.number() })),
  costUsd: z.number(),
  castCostUsd: z.number(),
  stopped: z.string().nullable(),
  transcripts: z.array(
    z.object({
      persona: z.string(),
      condition: z.string(),
      costUsd: z.number(),
      entries: z.array(
        z.object({
          at: z.number(),
          saw: z.array(z.object({ who: z.string(), text: z.string() })),
          did: z.string().nullable(),
          why: z.string(),
        }),
      ),
    }),
  ),
});

const settingsSchema = z.object({
  participants: z.number(),
  seed: z.number(),
  personas: z.array(z.string()).optional(),
  budgetUsd: z.number().optional(),
  keep: z.boolean().optional(),
});

const runSchema = z.object({
  status: z.enum(["running", "done", "error"]),
  settings: settingsSchema,
  report: reportSchema.nullable(),
  /** What in the report is worth a look, in plain words. */
  findings: z.array(z.string()),
  startedBy: z.string(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type SimulationRunSummary = z.infer<typeof runSchema>;

const simulationsSchema = z.object({
  studyId: z.string(),
  title: z.string(),
  version: z.number(),
  /** Whether this researcher can start a run. Viewers can only read the report. */
  canRun: z.boolean(),
  latest: runSchema.nullable(),
  /** The most participants one run can have. */
  most: z.number(),
  /** The personas in this version's personas.yaml, and the model that plays them. */
  personas: z.array(z.object({ id: z.string(), about: z.string() })),
  model: z.string().nullable(),
  /** Whether a model is set up on this server, so personas can run. */
  canPlay: z.boolean(),
  /** How many synthetic participants this study has kept. */
  synthetic: z.number(),
});

const versionParams = z.object({ versionId: z.uuid() });

const getRoute = createRoute({
  method: "get",
  path: "/admin/versions/{versionId}/simulations",
  summary: "How the latest run of simulated participants went for a version",
  request: { params: versionParams },
  responses: {
    200: {
      description: "Its latest run",
      content: { "application/json": { schema: simulationsSchema } },
    },
    401: errorResponse("Not signed in"),
    404: errorResponse("No such version on this researcher's teams"),
  },
});

const runRoute = createRoute({
  method: "post",
  path: "/admin/versions/{versionId}/simulations",
  summary: "Send simulated participants through a version. It runs in the background",
  request: {
    params: versionParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            /** How many behave at random. Ignored when personas are given. */
            participants: z.number().int().min(1).max(MAX_SIMULATED).default(1),
            /** Leave out for a new one. */
            seed: z.number().int().nonnegative().optional(),
            /** Personas for a model to play, by id, one participant each. */
            personas: z.array(z.string()).max(MAX_SIMULATED).optional(),
            /** The most the model playing personas may spend, in US dollars. */
            budgetUsd: z.number().positive().max(100).default(2),
            /** Keep them as synthetic data. */
            keep: z.boolean().default(false),
          }),
        },
      },
    },
  },
  responses: {
    202: {
      description: "Started",
      content: { "application/json": { schema: simulationsSchema } },
    },
    400: errorResponse("A persona isn't in this version, or no model is set up to play them"),
    401: errorResponse("Not signed in"),
    403: errorResponse("This researcher can only view"),
    404: errorResponse("No such version on this researcher's teams"),
    409: errorResponse("A run is already going"),
  },
});

const summarize = (row: typeof schema.simulationRuns.$inferSelect): SimulationRunSummary => {
  const stale = row.status === "running" && Date.now() - row.startedAt.getTime() > STALE_MS;
  // Reports from before personas lack their parts.
  const report = row.report
    ? ({
        costUsd: 0,
        castCostUsd: 0,
        stopped: null,
        transcripts: [],
        ...(row.report as Partial<SimulationReport>),
      } as SimulationReport)
    : null;
  return {
    status: stale ? "error" : row.status,
    settings: row.settings as SimulationSettings,
    report,
    findings: stale
      ? ["It stopped before it finished."]
      : report
        ? findings(report)
        : row.status === "error"
          ? ["Something went wrong."]
          : [],
    startedBy: row.startedBy,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
};

async function latestRun(db: Database, versionId: string) {
  const [row] = await db
    .select()
    .from(schema.simulationRuns)
    .where(eq(schema.simulationRuns.studyVersionId, versionId))
    .orderBy(desc(schema.simulationRuns.startedAt))
    .limit(1);
  return row ? summarize(row) : null;
}

/**
 * Starts simulated participants through a version in the background. Returns false if a run is
 * already going there.
 */
export async function startSimulation(
  { db, storage, writer = null }: { db: Database; storage: Storage; writer?: Writer | null },
  versionId: string,
  settings: SimulationSettings,
  startedBy: string,
): Promise<boolean> {
  const [running] = await db
    .select({ id: schema.simulationRuns.id })
    .from(schema.simulationRuns)
    .where(
      and(
        eq(schema.simulationRuns.studyVersionId, versionId),
        eq(schema.simulationRuns.status, "running"),
        gt(schema.simulationRuns.startedAt, new Date(Date.now() - STALE_MS)),
      ),
    );
  if (running) {
    return false;
  }
  const [row] = await db
    .insert(schema.simulationRuns)
    .values({ studyVersionId: versionId, status: "running", settings, startedBy })
    .returning({ id: schema.simulationRuns.id });
  const finish = (values: Partial<typeof schema.simulationRuns.$inferInsert>) =>
    db
      .update(schema.simulationRuns)
      .set({ ...values, finishedAt: new Date() })
      .where(eq(schema.simulationRuns.id, row?.id as string));
  void simulate({ db, storage, versionId, settings, cleanUp: true, writer })
    .then((report) => finish({ status: "done", report }))
    .catch((error: unknown) => {
      console.error("Simulated participants failed to run:", error);
      return finish({ status: "error" });
    });
  return true;
}

/** The personas saved with a version, and the model that plays them. */
async function personasOf(db: Database, versionId: string) {
  const [version] = await db
    .select({ pages: schema.studyVersions.pages })
    .from(schema.studyVersions)
    .where(eq(schema.studyVersions.id, versionId));
  const text = (version?.pages as Record<string, string> | undefined)?.[PERSONAS_FILE];
  return text ? parsePersonas(text).personas : null;
}

export function createSimulationRoutes({
  db,
  storage,
  writer = null,
}: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };
  const notAvailable = { error: "This isn't available." };

  const access = async (c: Parameters<typeof researcherFromRequest>[0], versionId: string) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return null;
    }
    const [version] = await db
      .select({
        studyId: schema.studyVersions.studyId,
        version: schema.studyVersions.version,
        settings: schema.studyVersions.settings,
      })
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.id, versionId));
    const role = version ? await roleOnStudy(db, researcher.id, version.studyId) : null;
    return { researcher, role, version };
  };
  const syntheticCount = async (studyId: string) =>
    (
      await db
        .select({ id: schema.participants.id })
        .from(schema.participants)
        .where(
          and(eq(schema.participants.studyId, studyId), eq(schema.participants.synthetic, true)),
        )
    ).length;
  const state = async (
    found: NonNullable<Awaited<ReturnType<typeof access>>>,
    versionId: string,
  ) => ({
    studyId: found.version?.studyId ?? "",
    title: (found.version?.settings as { title?: string } | undefined)?.title ?? "",
    version: found.version?.version ?? 0,
    canRun: found.role !== "viewer",
    latest: await latestRun(db, versionId),
    most: MAX_SIMULATED,
    ...(await personasOf(db, versionId).then((cast) => ({
      personas: (cast?.personas ?? []).map(({ id, about }) => ({ id, about })),
      model: cast?.model ?? null,
    }))),
    canPlay: writer !== null,
    synthetic: found.version ? await syntheticCount(found.version.studyId) : 0,
  });

  app.openapi(getRoute, async (c) => {
    const { versionId } = c.req.valid("param");
    const found = await access(c, versionId);
    if (!found) {
      return c.json(pleaseSignIn, 401);
    }
    if (!found.role) {
      return c.json(notAvailable, 404);
    }
    return c.json(await state(found, versionId), 200);
  });

  app.openapi(runRoute, async (c) => {
    const { versionId } = c.req.valid("param");
    const found = await access(c, versionId);
    if (!found) {
      return c.json(pleaseSignIn, 401);
    }
    if (!found.role) {
      return c.json(notAvailable, 404);
    }
    if (found.role === "viewer") {
      return c.json({ error: "You can view this study, but not change it." }, 403);
    }
    const { participants, seed, personas, budgetUsd, keep } = c.req.valid("json");
    if (personas && personas.length > 0) {
      const cast = await personasOf(db, versionId);
      const missing = personas.find((id) => !cast?.personas.some((item) => item.id === id));
      if (missing) {
        return c.json({ error: `There's no persona "${missing}" in this version.` }, 400);
      }
      if (!writer) {
        return c.json(
          { error: "Personas need a Claude key on the server, and this one doesn't have one." },
          400,
        );
      }
    }
    const playing = personas && personas.length > 0 ? personas : undefined;
    const settings = {
      participants: playing ? playing.length : participants,
      seed: seed ?? Math.floor(Math.random() * 1_000_000),
      ...(playing ? { personas: playing, budgetUsd } : {}),
      ...(keep ? { keep } : {}),
    };
    if (
      !(await startSimulation({ db, storage, writer }, versionId, settings, found.researcher.name))
    ) {
      return c.json({ error: "Simulated participants are already going through it." }, 409);
    }
    return c.json(await state(found, versionId), 202);
  });

  return app;
}
