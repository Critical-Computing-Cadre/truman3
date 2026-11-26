import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { postRef, publishDay, whyNotWriting } from "../community/live.ts";
import type { WrittenPost } from "../community/write.ts";
import { scriptFor } from "../director/director.ts";
import { spentOn } from "../director/wording.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { researcherFromRequest } from "./session.ts";

// Watching a live community as it's written (ADR 102): what's been written for each day, approving
// or skipping a day that's held, and taking a post back out.

const errorBody = { "application/json": { schema: z.object({ error: z.string() }) } };
const params = z.object({ studyId: z.uuid() });

const postSchema = z.object({
  /** Its place in the day, which is how it's taken back out. */
  index: z.number(),
  removed: z.boolean(),
  actor: z.string(),
  title: z.string(),
  body: z.string(),
  minute: z.number(),
  replies: z.array(z.object({ actor: z.string(), body: z.string() })),
});

const stateSchema = z.object({
  on: z.boolean(),
  hold: z.boolean(),
  daysBefore: z.number(),
  daysDuring: z.number(),
  budgetUsd: z.number(),
  spentUsd: z.number(),
  /** Why nothing more is being written now, or null if it is. */
  whyNot: z.string().nullable(),
  days: z.array(
    z.object({
      id: z.string(),
      condition: z.string(),
      day: z.number(),
      status: z.enum(["writing", "held", "published", "skipped", "error"]),
      dropped: z.number(),
      costUsd: z.number(),
      error: z.string().nullable(),
      posts: z.array(postSchema),
    }),
  ),
});

const stateRoute = createRoute({
  method: "get",
  path: "/admin/studies/{studyId}/community",
  summary: "A study's live community: each day written so far, newest first",
  request: { params },
  responses: {
    200: { description: "Its state", content: { "application/json": { schema: stateSchema } } },
    401: { description: "Not signed in", content: errorBody },
    404: { description: "No such study", content: errorBody },
  },
});

const decideRoute = createRoute({
  method: "post",
  path: "/admin/studies/{studyId}/community/days/{dayId}",
  summary: "Approve a held day, so participants can see it, or skip it",
  request: {
    params: params.extend({ dayId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ decision: z.enum(["approve", "skip"]) }) },
      },
    },
  },
  responses: {
    200: {
      description: "Done",
      content: { "application/json": { schema: z.object({ status: z.string() }) } },
    },
    401: { description: "Not signed in", content: errorBody },
    403: { description: "Viewers can't", content: errorBody },
    404: { description: "No such day", content: errorBody },
    409: { description: "It isn't waiting any more", content: errorBody },
  },
});

const removeRoute = createRoute({
  method: "delete",
  path: "/admin/studies/{studyId}/community/days/{dayId}/posts/{index}",
  summary: "Take a post the live community wrote back out, with its replies",
  request: {
    params: params.extend({ dayId: z.uuid(), index: z.coerce.number().int().min(0) }),
  },
  responses: {
    200: {
      description: "Removed, from everyone who had it and everyone still to reach it",
      content: { "application/json": { schema: z.object({ removed: z.boolean() }) } },
    },
    401: { description: "Not signed in", content: errorBody },
    403: { description: "Viewers can't", content: errorBody },
    404: { description: "No such post", content: errorBody },
  },
});

export function createLiveCommunityRoutes({ db, writer }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();

  const access = async (c: Parameters<typeof researcherFromRequest>[0], studyId: string) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return { failure: [{ error: "Please sign in." }, 401] as const };
    }
    const role = await roleOnStudy(db, researcher.id, studyId);
    const [study] = await db.select().from(schema.studies).where(eq(schema.studies.id, studyId));
    if (!role || !study) {
      return { failure: [{ error: "That isn't available." }, 404] as const };
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
    return { researcher, role, versionId: version?.id ?? null };
  };

  app.openapi(stateRoute, async (c) => {
    const { studyId } = c.req.valid("param");
    const checked = await access(c, studyId);
    if ("failure" in checked) {
      const [body, status] = checked.failure;
      return c.json(body, status);
    }
    const { versionId } = checked;
    const script = versionId ? await scriptFor(db, versionId) : null;
    const community = script?.community;
    if (!versionId || !community?.live) {
      return c.json(
        {
          on: false,
          hold: false,
          daysBefore: 0,
          daysDuring: 0,
          budgetUsd: 0,
          spentUsd: 0,
          whyNot: null,
          days: [],
        },
        200,
      );
    }
    const days = await db
      .select()
      .from(schema.communityDays)
      .where(eq(schema.communityDays.studyVersionId, versionId))
      .orderBy(desc(schema.communityDays.day), asc(schema.communityDays.condition));
    return c.json(
      {
        on: true,
        hold: community.hold,
        daysBefore: community.daysBefore,
        daysDuring: community.daysDuring,
        budgetUsd: script?.live.budgetUsd ?? 0,
        spentUsd: await spentOn(db, versionId),
        whyNot: await whyNotWriting(db, writer, versionId),
        days: days.map((day) => ({
          id: day.id,
          condition: day.condition,
          day: day.day,
          status: day.status,
          dropped: day.dropped,
          costUsd: day.costUsd,
          error: day.error,
          posts: (day.written as WrittenPost[]).map((post, index) => ({
            index,
            removed: day.removed.includes(index),
            actor: post.actor,
            title: post.title,
            body: post.body,
            minute: post.minute,
            replies: post.replies.map(({ actor, body }) => ({ actor, body })),
          })),
        })),
      },
      200,
    );
  });

  app.openapi(decideRoute, async (c) => {
    const { studyId, dayId } = c.req.valid("param");
    const checked = await access(c, studyId);
    if ("failure" in checked) {
      const [body, status] = checked.failure;
      return c.json(body, status);
    }
    if (checked.role === "viewer") {
      return c.json({ error: "You can only view this study." }, 403);
    }
    const [day] = await db
      .select({ day: schema.communityDays })
      .from(schema.communityDays)
      .innerJoin(
        schema.studyVersions,
        eq(schema.studyVersions.id, schema.communityDays.studyVersionId),
      )
      .where(and(eq(schema.communityDays.id, dayId), eq(schema.studyVersions.studyId, studyId)));
    if (!day) {
      return c.json({ error: "That isn't available." }, 404);
    }
    const gone = { error: "That day isn't waiting any more." };
    if (c.req.valid("json").decision === "approve") {
      if (day.day.status !== "held" || !(await publishDay(db, day.day.id, checked.researcher.id))) {
        return c.json(gone, 409);
      }
      return c.json({ status: "published" }, 200);
    }
    const [skipped] = await db
      .update(schema.communityDays)
      .set({ status: "skipped", decidedBy: checked.researcher.id })
      .where(and(eq(schema.communityDays.id, dayId), eq(schema.communityDays.status, "held")))
      .returning({ id: schema.communityDays.id });
    return skipped ? c.json({ status: "skipped" }, 200) : c.json(gone, 409);
  });

  app.openapi(removeRoute, async (c) => {
    const { studyId, dayId, index } = c.req.valid("param");
    const checked = await access(c, studyId);
    if ("failure" in checked) {
      const [body, status] = checked.failure;
      return c.json(body, status);
    }
    if (checked.role === "viewer") {
      return c.json({ error: "You can only view this study." }, 403);
    }
    const [found] = await db
      .select({ day: schema.communityDays })
      .from(schema.communityDays)
      .innerJoin(
        schema.studyVersions,
        eq(schema.studyVersions.id, schema.communityDays.studyVersionId),
      )
      .where(and(eq(schema.communityDays.id, dayId), eq(schema.studyVersions.studyId, studyId)));
    if (!found || index >= (found.day.written as WrittenPost[]).length) {
      return c.json({ error: "That isn't available." }, 404);
    }
    const { day } = found;
    await db.transaction(async (tx) => {
      // Nobody who reaches this day from now on gets it.
      await tx
        .update(schema.communityDays)
        .set({ removed: sql`array_append(${schema.communityDays.removed}, ${index}::integer)` })
        .where(
          and(
            eq(schema.communityDays.id, dayId),
            sql`not (${index}::integer = any(${schema.communityDays.removed}))`,
          ),
        );
      // And it's left out for everyone who already has it. Its replies go with it.
      const worlds = tx
        .select({ id: schema.communityDayWorlds.worldId })
        .from(schema.communityDayWorlds)
        .where(eq(schema.communityDayWorlds.dayId, dayId));
      await tx
        .update(schema.content)
        .set({ withdrawnAt: new Date() })
        .where(
          and(
            inArray(schema.content.worldId, worlds),
            eq(schema.content.kind, "post"),
            eq(schema.content.sourceRef, postRef(day, index)),
            isNull(schema.content.withdrawnAt),
          ),
        );
    });
    return c.json({ removed: true }, 200);
  });

  return app;
}
