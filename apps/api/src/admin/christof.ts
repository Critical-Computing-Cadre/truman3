import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { desc, eq } from "drizzle-orm";
import { scriptFor } from "../director/director.ts";
import type { Writing } from "../director/wording.ts";
import { spentOn } from "../director/wording.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { researcherFromRequest } from "./session.ts";

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const studyParams = z.object({ studyId: z.uuid() });
const commonErrors = {
  401: errorResponse("Not signed in"),
  403: errorResponse("This researcher's role doesn't allow this"),
  404: errorResponse("No such study on this researcher's teams"),
};

/** How many of the latest decisions the monitor shows. The export has all of them. */
const RUNS_SHOWN = 50;

const controlsSchema = z.object({
  livePaused: z.boolean(),
  pausedActors: z.array(z.string()),
});

const stateRoute = createRoute({
  method: "get",
  path: "/admin/studies/{studyId}/christof",
  summary: "What Christof is doing in this study: live writing, its spending, and recent decisions",
  request: { params: studyParams },
  responses: {
    200: {
      description: "Christof's state",
      content: {
        "application/json": {
          schema: controlsSchema.extend({
            /** Whether this server can write live at all. */
            hasModel: z.boolean(),
            live: z.object({ enabled: z.boolean(), model: z.string(), budgetUsd: z.number() }),
            spentUsd: z.number(),
            /** People in the cast who improvise, who can be paused one at a time. */
            improvisers: z.array(z.string()),
            runs: z.array(
              z.object({
                id: z.string(),
                beat: z.string(),
                status: z.string(),
                reason: z.string().nullable(),
                dueAt: z.iso.datetime(),
                actor: z.string().nullable(),
                pilot: z.boolean(),
                mode: z.enum(["live", "fallback"]).nullable(),
                output: z.string().nullable(),
                model: z.string().nullable(),
                costUsd: z.number().nullable(),
              }),
            ),
          }),
        },
      },
    },
    ...commonErrors,
  },
});

const controlRoute = createRoute({
  method: "put",
  path: "/admin/studies/{studyId}/christof",
  summary: "Pause or resume live writing, for the whole study or some of the cast",
  request: {
    params: studyParams,
    body: { required: true, content: { "application/json": { schema: controlsSchema } } },
  },
  responses: {
    200: {
      description: "Saved. It takes effect at the next beat",
      content: { "application/json": { schema: controlsSchema } },
    },
    ...commonErrors,
  },
});

export function createChristofRoutes({ db, writer }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };
  const notAvailable = { error: "This isn't available." };

  app.openapi(stateRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId } = c.req.valid("param");
    const role = await roleOnStudy(db, researcher.id, studyId);
    const [study] = await db.select().from(schema.studies).where(eq(schema.studies.id, studyId));
    if (!role || !study) {
      return c.json(notAvailable, 404);
    }
    // What's running now, or the newest version if nothing is.
    const [version] = study.liveVersionId
      ? [{ id: study.liveVersionId }]
      : await db
          .select({ id: schema.studyVersions.id })
          .from(schema.studyVersions)
          .where(eq(schema.studyVersions.studyId, studyId))
          .orderBy(desc(schema.studyVersions.version))
          .limit(1);
    const script = version ? await scriptFor(db, version.id) : null;
    const improvisers = [
      ...new Set(
        (script?.beats ?? []).flatMap((beat) =>
          "improvise" in beat.do && beat.do.improvise ? [beat.do.actor] : [],
        ),
      ),
    ].sort();

    const runs = await db
      .select({
        run: schema.beatRuns,
        actor: schema.actors.username,
        pilot: schema.participants.isPilot,
      })
      .from(schema.beatRuns)
      .innerJoin(schema.worlds, eq(schema.worlds.id, schema.beatRuns.worldId))
      .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.worlds.studyVersionId))
      .innerJoin(schema.worldMemberships, eq(schema.worldMemberships.worldId, schema.worlds.id))
      .innerJoin(
        schema.participants,
        eq(schema.participants.id, schema.worldMemberships.participantId),
      )
      .leftJoin(schema.actors, eq(schema.actors.id, schema.beatRuns.actorId))
      .where(eq(schema.studyVersions.studyId, studyId))
      .orderBy(desc(schema.beatRuns.dueAt))
      .limit(RUNS_SHOWN);

    return c.json(
      {
        hasModel: Boolean(writer),
        live: {
          enabled: script?.live.enabled ?? false,
          model: script?.live.model ?? "",
          budgetUsd: script?.live.budgetUsd ?? 0,
        },
        spentUsd: version ? await spentOn(db, version.id) : 0,
        livePaused: study.livePaused,
        pausedActors: study.pausedActors,
        improvisers,
        runs: runs.map(({ run, actor, pilot }) => {
          const writing = run.writing as Writing | null;
          return {
            id: run.id,
            beat: run.beat,
            status: run.status,
            reason: run.reason ?? writing?.reason ?? null,
            dueAt: run.dueAt.toISOString(),
            actor,
            pilot,
            mode: writing?.mode ?? null,
            output: writing?.output ?? null,
            model: writing?.model ?? null,
            costUsd: writing?.costUsd ?? null,
          };
        }),
      },
      200,
    );
  });

  app.openapi(controlRoute, async (c) => {
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
    const { livePaused, pausedActors } = c.req.valid("json");
    const [saved] = await db
      .update(schema.studies)
      .set({ livePaused, pausedActors: [...new Set(pausedActors)] })
      .where(eq(schema.studies.id, studyId))
      .returning({
        livePaused: schema.studies.livePaused,
        pausedActors: schema.studies.pausedActors,
      });
    return saved ? c.json(saved, 200) : c.json(notAvailable, 404);
  });

  return app;
}
