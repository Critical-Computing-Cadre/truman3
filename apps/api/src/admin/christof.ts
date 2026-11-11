import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { whyNoModel } from "../ai.ts";
import { decideAwaiting, scriptFor } from "../director/director.ts";
import type { Writing } from "../director/wording.ts";
import { spentOn } from "../director/wording.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { loadWorldContext, realClock } from "../participants/session.ts";
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
            /** Why this lab can't use a model now, or null if it can (ADR 71). */
            noModel: z.string().nullable(),
            live: z.object({ enabled: z.boolean(), model: z.string(), budgetUsd: z.number() }),
            spentUsd: z.number(),
            /** People in the cast who improvise, who can be paused one at a time. */
            improvisers: z.array(z.string()),
            /** Beats waiting for a researcher, oldest first, with what they're about. */
            awaiting: z.array(
              z.object({
                id: z.string(),
                beat: z.string(),
                note: z.string().nullable(),
                action: z.string(),
                actor: z.string().nullable(),
                pilot: z.boolean(),
                waitingSince: z.iso.datetime(),
                /** When its fallback or fixed line will be used instead. Empty is never. */
                deadline: z.iso.datetime().nullable(),
                draft: z.string().nullable(),
                /** What it's on, so the line can be read in place. */
                onText: z.string().nullable(),
                onAuthor: z.string().nullable(),
              }),
            ),
            runs: z.array(
              z.object({
                id: z.string(),
                beat: z.string(),
                status: z.string(),
                reason: z.string().nullable(),
                dueAt: z.iso.datetime(),
                actor: z.string().nullable(),
                pilot: z.boolean(),
                mode: z.enum(["live", "rehearsed", "fallback", "fixed"]).nullable(),
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

const decideRoute = createRoute({
  method: "post",
  path: "/admin/studies/{studyId}/christof/runs/{runId}",
  summary: "Approve, edit, or skip a beat that's waiting for a researcher",
  request: {
    params: studyParams.extend({ runId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            action: z.enum(["approve", "skip"]),
            /** The line to post, if it's changed. Leave out to post the draft. */
            text: z.string().trim().min(1).max(5000).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Decided",
      content: {
        "application/json": { schema: z.object({ status: z.enum(["fired", "skipped"]) }) },
      },
    },
    409: errorResponse("It isn't waiting any more"),
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

export function createChristofRoutes({
  db,
  writer,
  clock = realClock,
}: ParticipantRouteDependencies) {
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

    const waiting = await db
      .select({
        run: schema.beatRuns,
        actor: schema.actors.username,
        pilot: schema.participants.isPilot,
        onText: schema.content.body,
        onAuthorId: schema.content.authorActorId,
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
      .leftJoin(schema.content, eq(schema.content.id, schema.beatRuns.targetContentId))
      // Synthetic participants are kept, but nobody needs to approve or read about them here.
      .where(
        and(
          eq(schema.studyVersions.studyId, studyId),
          eq(schema.beatRuns.status, "awaiting"),
          eq(schema.participants.synthetic, false),
        ),
      )
      .orderBy(asc(schema.beatRuns.decidedAt));
    const authorIds = [
      ...new Set(waiting.flatMap(({ onAuthorId }) => (onAuthorId ? [onAuthorId] : []))),
    ];
    const authors = authorIds.length
      ? await db
          .select({
            id: schema.actors.id,
            username: schema.actors.username,
            worldId: schema.actors.worldId,
          })
          .from(schema.actors)
          .where(inArray(schema.actors.id, authorIds))
      : [];
    const timeout = script?.live.approvalTimeout ?? null;

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
      .where(
        and(eq(schema.studyVersions.studyId, studyId), eq(schema.participants.synthetic, false)),
      )
      .orderBy(desc(schema.beatRuns.dueAt))
      .limit(RUNS_SHOWN);

    const noModel = await whyNoModel(writer, { studyId });
    return c.json(
      {
        hasModel: noModel === null,
        noModel,
        live: {
          enabled: script?.live.enabled ?? false,
          model: script?.live.model ?? "",
          budgetUsd: script?.live.budgetUsd ?? 0,
        },
        spentUsd: version ? await spentOn(db, version.id) : 0,
        livePaused: study.livePaused,
        pausedActors: study.pausedActors,
        improvisers,
        awaiting: waiting.map(({ run, actor, pilot, onText, onAuthorId }) => {
          const beat = script?.beats.find(({ id }) => id === run.beat);
          const since = run.decidedAt ?? run.dueAt;
          const author = authors.find(({ id }) => id === onAuthorId);
          return {
            id: run.id,
            beat: run.beat,
            note: beat?.note ?? null,
            action: beat?.do.action ?? "",
            actor,
            pilot,
            waitingSince: since.toISOString(),
            deadline: timeout === null ? null : new Date(since.getTime() + timeout).toISOString(),
            draft: (run.writing as Writing | null)?.draft ?? null,
            onText,
            // A participant's own username can identify them, so they're "the participant" here.
            onAuthor: author ? (author.worldId ? "the participant" : author.username) : null,
          };
        }),
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

  app.openapi(decideRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId, runId } = c.req.valid("param");
    const role = await roleOnStudy(db, researcher.id, studyId);
    if (!role) {
      return c.json(notAvailable, 404);
    }
    if (role === "viewer") {
      return c.json({ error: "You can view this study, but not change it." }, 403);
    }
    const [run] = await db
      .select({
        worldId: schema.beatRuns.worldId,
        forActorId: schema.beatRuns.forActorId,
        studyId: schema.studyVersions.studyId,
      })
      .from(schema.beatRuns)
      .innerJoin(schema.worlds, eq(schema.worlds.id, schema.beatRuns.worldId))
      .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.worlds.studyVersionId))
      .where(eq(schema.beatRuns.id, runId));
    // In a shared world, as the participant the beat is for (ADR 67).
    const context =
      run?.studyId === studyId ? await loadWorldContext(db, run.worldId, run.forActorId) : null;
    if (!context) {
      return c.json(notAvailable, 404);
    }
    const { action, text } = c.req.valid("json");
    const status = await decideAwaiting(
      db,
      context,
      runId,
      {
        action,
        text,
        by: researcher.name,
      },
      clock(),
    );
    return status
      ? c.json({ status }, 200)
      : c.json({ error: "Someone else decided it, or its time ran out." }, 409);
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
