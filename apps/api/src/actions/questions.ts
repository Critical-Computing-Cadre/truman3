import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  type AskedQuestion,
  type FeedQuestion,
  featuresFor,
  feedQuestionSchema,
  problemWithAnswers,
  questionAnswerSchema,
} from "@truman3/core";
import { type Database, recordEvent, schema } from "@truman3/db";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { catchUp } from "../director/director.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import {
  type ParticipantContext,
  participantFromRequest,
  realClock,
} from "../participants/session.ts";
import { actionMetaSchema } from "./request.ts";
import { participantEvent } from "./routes.ts";

/**
 * Questions a beat asks a participant in the feed (ADR 89). A beat with `action: ask` puts a row
 * in `beat_asks` when it's due. These routes hand the waiting ones to the participant's screen,
 * and take what they answer, or that they put it aside.
 */

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const okResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
});
const jsonBody = <T extends z.ZodType>(body: T) => ({
  body: { content: { "application/json": { schema: body } }, required: true },
});
const askParams = z.object({ id: z.uuid() });

/** How long it was on their screen, by their device. Left out if their device's clock is off. */
const shown = { shownAt: z.iso.datetime().optional() };

const questionsRoute = createRoute({
  method: "get",
  path: "/questions",
  summary: "What a beat has asked this person and they haven't answered yet",
  responses: {
    200: {
      description: "Oldest first",
      content: {
        "application/json": { schema: z.object({ questions: z.array(feedQuestionSchema) }) },
      },
    },
    401: errorResponse("Not signed in"),
    403: errorResponse("That feature is off in this condition"),
  },
});

const answerRoute = createRoute({
  method: "post",
  path: "/questions/{id}/answer",
  summary: "Answer what a beat asked",
  request: {
    params: askParams,
    ...jsonBody(
      actionMetaSchema.extend({ answers: z.record(z.string(), questionAnswerSchema), ...shown }),
    ),
  },
  responses: {
    200: okResponse("Recorded"),
    400: errorResponse("A question is unanswered, or has an answer it didn't offer"),
    401: errorResponse("Not signed in"),
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("Not one of this person's questions"),
  },
});

const dismissRoute = createRoute({
  method: "post",
  path: "/questions/{id}/dismiss",
  summary: "Put aside what a beat asked, without answering",
  request: { params: askParams, ...jsonBody(actionMetaSchema.extend(shown)) },
  responses: {
    200: okResponse("Recorded"),
    400: errorResponse("This one has to be answered"),
    401: errorResponse("Not signed in"),
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("Not one of this person's questions"),
  },
});

const isOff = (context: ParticipantContext) =>
  !featuresFor(context.settings, context.conditionKey).questions;

/** What's waiting for this person: asked by now, and neither answered nor put aside. */
export async function listQuestions(
  db: Database,
  context: ParticipantContext,
  now: Date,
): Promise<FeedQuestion[]> {
  const rows = await db
    .select()
    .from(schema.beatAsks)
    .where(
      and(
        eq(schema.beatAsks.worldId, context.worldId),
        eq(schema.beatAsks.recipientActorId, context.actorId),
        isNull(schema.beatAsks.answeredAt),
        isNull(schema.beatAsks.dismissedAt),
        lte(schema.beatAsks.dueAt, now),
      ),
    )
    .orderBy(asc(schema.beatAsks.dueAt));
  return rows.map((row) => ({
    id: row.id,
    ...(row.title ? { title: row.title } : {}),
    questions: row.questions as AskedQuestion[],
    required: row.required,
  }));
}

/** From when it was on their screen to when they acted, if their device's clock makes sense. */
function tookMs(shownAt: string | undefined, occurredAt: string) {
  if (!shownAt) {
    return undefined;
  }
  const ms = new Date(occurredAt).getTime() - new Date(shownAt).getTime();
  return ms >= 0 && ms < 24 * 60 * 60 * 1000 ? ms : undefined;
}

export function createQuestionRoutes({
  db,
  writer,
  clock = realClock,
}: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };
  const featureOff = { error: "This isn't part of this platform." };
  const notAvailable = { error: "This isn't available." };

  /** One of this person's questions that's been asked by now, or nothing. */
  const findAsk = async (context: ParticipantContext, id: string) => {
    const [ask] = await db
      .select()
      .from(schema.beatAsks)
      .where(
        and(
          eq(schema.beatAsks.id, id),
          eq(schema.beatAsks.worldId, context.worldId),
          eq(schema.beatAsks.recipientActorId, context.actorId),
          lte(schema.beatAsks.dueAt, clock()),
        ),
      );
    return ask;
  };

  app.openapi(questionsRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context)) {
      return c.json(featureOff, 403);
    }
    // A question set off by what they just did should be there when their screen next asks, not
    // only after they next load the feed.
    await catchUp(db, context, { writer, now: clock() });
    return c.json({ questions: await listQuestions(db, context, clock()) }, 200);
  });

  app.openapi(answerRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context)) {
      return c.json(featureOff, 403);
    }
    const ask = await findAsk(context, c.req.valid("param").id);
    if (!ask) {
      return c.json(notAvailable, 404);
    }
    // Pressing it twice, as on a slow connection, still counts as the first time.
    if (ask.answeredAt) {
      return c.json({ ok: true as const }, 200);
    }
    const body = c.req.valid("json");
    const problem = problemWithAnswers(ask.questions as AskedQuestion[], body.answers);
    if (problem) {
      return c.json({ error: problem }, 400);
    }
    const took = tookMs(body.shownAt, body.occurredAt);
    await db.transaction(async (tx) => {
      const recorded = await recordEvent(tx, {
        ...participantEvent(context, body.occurredAt, body.clientEventId),
        type: "question.answered",
        payload: {
          beat: ask.beat,
          answers: body.answers,
          ...(took === undefined ? {} : { tookMs: took }),
        },
      });
      if (recorded) {
        // An answer after putting it aside can't happen from the screen, but if it did, the
        // answer is what's kept.
        await tx
          .update(schema.beatAsks)
          .set({
            answeredAt: clock(),
            dismissedAt: null,
            answers: body.answers,
            tookMs: took ?? null,
          })
          .where(eq(schema.beatAsks.id, ask.id));
      }
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(dismissRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context)) {
      return c.json(featureOff, 403);
    }
    const ask = await findAsk(context, c.req.valid("param").id);
    if (!ask) {
      return c.json(notAvailable, 404);
    }
    if (ask.answeredAt || ask.dismissedAt) {
      return c.json({ ok: true as const }, 200);
    }
    if (ask.required) {
      return c.json({ error: "This one needs an answer." }, 400);
    }
    const body = c.req.valid("json");
    const took = tookMs(body.shownAt, body.occurredAt);
    await db.transaction(async (tx) => {
      const recorded = await recordEvent(tx, {
        ...participantEvent(context, body.occurredAt, body.clientEventId),
        type: "question.dismissed",
        payload: { beat: ask.beat, ...(took === undefined ? {} : { tookMs: took }) },
      });
      if (recorded) {
        await tx
          .update(schema.beatAsks)
          .set({ dismissedAt: clock(), tookMs: took ?? null })
          .where(eq(schema.beatAsks.id, ask.id));
      }
    });
    return c.json({ ok: true as const }, 200);
  });

  return app;
}
