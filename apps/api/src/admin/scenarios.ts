import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import { SCENARIOS_FILE } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import { parseScenarios } from "@truman3/study-files";
import { and, desc, eq, gt } from "drizzle-orm";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { runScenarios } from "../scenarios/run.ts";
import { researcherFromRequest } from "./session.ts";

/**
 * Scenario tests, run on the server for a saved version: by themselves when a version is saved,
 * and again from a button. Test participants are deleted after each run, and only the results are
 * kept. See ADR 57.
 */

/** A run that's been going this long is taken to have stopped, such as in a restart. */
const STALE_MS = 10 * 60_000;

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});

export const scenarioRunSchema = z.object({
  status: z.enum(["running", "passed", "failed", "error"]),
  results: z.array(
    z.object({ name: z.string(), passed: z.boolean(), problems: z.array(z.string()) }),
  ),
  startedBy: z.string(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type ScenarioRunSummary = z.infer<typeof scenarioRunSchema>;

const testsSchema = z.object({
  /** How many scenarios the version has. None means there's nothing to run. */
  scenarios: z.number(),
  latest: scenarioRunSchema.nullable(),
});

const versionParams = z.object({ versionId: z.uuid() });

const getRoute = createRoute({
  method: "get",
  path: "/admin/versions/{versionId}/scenarios",
  summary: "A version's scenario tests, and how the latest run went",
  request: { params: versionParams },
  responses: {
    200: { description: "Its tests", content: { "application/json": { schema: testsSchema } } },
    401: errorResponse("Not signed in"),
    404: errorResponse("No such version on this researcher's teams"),
  },
});

const runRoute = createRoute({
  method: "post",
  path: "/admin/versions/{versionId}/scenarios",
  summary: "Run a version's scenario tests. They run in the background; check back for results",
  request: { params: versionParams },
  responses: {
    202: { description: "Started", content: { "application/json": { schema: testsSchema } } },
    400: errorResponse("It has no scenarios"),
    401: errorResponse("Not signed in"),
    403: errorResponse("This researcher can only view"),
    404: errorResponse("No such version on this researcher's teams"),
  },
});

const warningRoute = createRoute({
  method: "put",
  path: "/admin/studies/{studyId}/scenario-warning",
  summary: "Whether launching a version whose scenario tests haven't passed shows a warning",
  request: {
    params: z.object({ studyId: z.uuid() }),
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ warn: z.boolean() }) } },
    },
  },
  responses: {
    200: {
      description: "Saved",
      content: { "application/json": { schema: z.object({ warn: z.boolean() }) } },
    },
    401: errorResponse("Not signed in"),
    403: errorResponse("This researcher can only view"),
    404: errorResponse("No such study on this researcher's teams"),
  },
});

const summarize = (row: typeof schema.scenarioRuns.$inferSelect): ScenarioRunSummary => {
  const stale = row.status === "running" && Date.now() - row.startedAt.getTime() > STALE_MS;
  return {
    status: stale ? "error" : row.status,
    results: stale
      ? [{ name: "The run", passed: false, problems: ["It stopped before it finished."] }]
      : (row.results as ScenarioRunSummary["results"]),
    startedBy: row.startedBy,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
};

/** How many scenarios a version has, from the scenarios.yaml saved with it. */
async function scenariosOf(db: Database, versionId: string) {
  const [version] = await db
    .select({ pages: schema.studyVersions.pages })
    .from(schema.studyVersions)
    .where(eq(schema.studyVersions.id, versionId));
  const text = (version?.pages as Record<string, string> | undefined)?.[SCENARIOS_FILE];
  return text ? parseScenarios(text).scenarios : [];
}

/** The latest run for each of these versions. */
export async function latestRuns(db: Database, versionIds: readonly string[]) {
  const latest = new Map<string, ScenarioRunSummary>();
  for (const versionId of versionIds) {
    const [row] = await db
      .select()
      .from(schema.scenarioRuns)
      .where(eq(schema.scenarioRuns.studyVersionId, versionId))
      .orderBy(desc(schema.scenarioRuns.startedAt))
      .limit(1);
    if (row) {
      latest.set(versionId, summarize(row));
    }
  }
  return latest;
}

/**
 * Starts a version's scenario tests in the background, unless it has none or they're already
 * running. Returns whether they started.
 */
export async function startScenarioRun(
  { db, storage }: { db: Database; storage: Storage },
  versionId: string,
  startedBy: string,
): Promise<boolean> {
  const scenarios = await scenariosOf(db, versionId);
  if (scenarios.length === 0) {
    return false;
  }
  const [running] = await db
    .select({ id: schema.scenarioRuns.id })
    .from(schema.scenarioRuns)
    .where(
      and(
        eq(schema.scenarioRuns.studyVersionId, versionId),
        eq(schema.scenarioRuns.status, "running"),
        gt(schema.scenarioRuns.startedAt, new Date(Date.now() - STALE_MS)),
      ),
    );
  if (running) {
    return true;
  }
  const [row] = await db
    .insert(schema.scenarioRuns)
    .values({ studyVersionId: versionId, status: "running", startedBy })
    .returning({ id: schema.scenarioRuns.id });
  const finish = (values: Partial<typeof schema.scenarioRuns.$inferInsert>) =>
    db
      .update(schema.scenarioRuns)
      .set({ ...values, finishedAt: new Date() })
      .where(eq(schema.scenarioRuns.id, row?.id as string));
  // In the background, so saving a version or pressing the button doesn't wait for it.
  void runScenarios({ db, storage, versionId, scenarios, cleanUp: true })
    .then((results) =>
      finish({ status: results.every(({ passed }) => passed) ? "passed" : "failed", results }),
    )
    .catch((error: unknown) => {
      console.error("Scenario tests failed to run:", error);
      return finish({
        status: "error",
        results: [{ name: "The run", passed: false, problems: ["Something went wrong."] }],
      });
    });
  return true;
}

export function createScenarioRoutes({ db, storage }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };
  const notAvailable = { error: "This isn't available." };

  const access = async (c: Parameters<typeof researcherFromRequest>[0], versionId: string) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return null;
    }
    const [version] = await db
      .select({ studyId: schema.studyVersions.studyId })
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.id, versionId));
    const role = version ? await roleOnStudy(db, researcher.id, version.studyId) : null;
    return { researcher, role };
  };
  const tests = async (versionId: string) => ({
    scenarios: (await scenariosOf(db, versionId)).length,
    latest: (await latestRuns(db, [versionId])).get(versionId) ?? null,
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
    return c.json(await tests(versionId), 200);
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
    if (!(await startScenarioRun({ db, storage }, versionId, found.researcher.name))) {
      return c.json({ error: "This version has no scenarios to run." }, 400);
    }
    return c.json(await tests(versionId), 202);
  });

  app.openapi(warningRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId } = c.req.valid("param");
    const role = await roleOnStudy(db, researcher.id, studyId);
    if (!role) {
      return c.json(notAvailable, 404);
    }
    if (role === "viewer") {
      return c.json({ error: "You can view this study, but not change it." }, 403);
    }
    const { warn } = c.req.valid("json");
    await db
      .update(schema.studies)
      .set({ warnUntested: warn })
      .where(eq(schema.studies.id, studyId));
    return c.json({ warn }, 200);
  });

  return app;
}
