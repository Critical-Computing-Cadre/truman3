import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  canLeaveFeed,
  currentFlowStep,
  eventPayloadSchemas,
  fillLinkTemplate,
  LAYOUT_KEYS,
  maxPostLengthFor,
  platformFor,
} from "@truman3/core";
import { type Database, recordEvent, schema, type Transaction } from "@truman3/db";
import { feedSettingsFor } from "@truman3/feed";
import { deleteParticipant } from "@truman3/study-import";
import { count, eq } from "drizzle-orm";
import { deleteCookie } from "hono/cookie";
import { actionMetaSchema } from "../actions/request.ts";
import { findVisibleContent } from "../actions/routes.ts";
import { mediaUrl } from "../feed/build.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import {
  type ParticipantContext,
  participantFromRequest,
  realClock,
  SESSION_COOKIE,
} from "../participants/session.ts";
import { prolificDeclineUrl, prolificFinishUrl } from "./prolific-exit.ts";

const errorSchema = z.object({ error: z.string() });

const flowStateSchema = z.object({
  step: z.enum(["consent", "account", "page", "feed", "exit", "done"]),
  /** Where they are, to send back when moving on. */
  position: z.number(),
  /** The Markdown text, for steps that show a page. */
  pageText: z.string().nullable(),
  /** On the feed step, whether they can choose to finish now. */
  canFinish: z.boolean(),
  /**
   * In a shared world that hasn't started (ADR 67): how many have joined, how many it's for, and
   * when it starts at the latest. Absent once it's started, or in a world of one.
   */
  waiting: z
    .object({ joined: z.number(), size: z.number(), startsBy: z.iso.datetime() })
    .optional(),
  /** Whether others share their world, so the page listens for what they do (ADR 68). */
  shared: z.boolean(),
  /** What their posts must contain. */
  platformStyle: z.enum(["photo", "text", "mixed"]),
  /** Light, dark, or whatever their device uses. */
  theme: z.enum(["light", "dark", "device"]),
  /** The site's main color, or null for the one its kind of site comes with. */
  accent: z.string().nullable(),
  /** What's only for show that the study left out, and what it added. */
  decor: z.object({ hide: z.array(z.string()), add: z.array(z.string()) }),
  /** Which button an "are you sure?" box makes dark. */
  sureButton: z.enum(["goBack", "postAnyway"]),
  /** Whether the comment box is always there, or appears on Reply. */
  commentBox: z.enum(["open", "onReply"]),
  /** How posts are arranged. */
  layout: z.enum(LAYOUT_KEYS),
  /** Which building blocks this platform has in their condition. */
  features: z.record(z.string(), z.boolean()),
  /** The most they can write in a post or comment, or null for no limit. */
  maxPostLength: z.number().nullable(),
  /** The tabs on the feed, on a platform with a following feed. */
  feedTabs: z.object({ home: z.string(), following: z.string(), startOnFollowing: z.boolean() }),
  /** Whether they can join and leave spaces, or the study has decided for them. */
  canJoinSpaces: z.boolean(),
  /** Whether they can choose a feed's order, or the study has decided for them. */
  canSort: z.boolean(),
  /** Whether they can choose an order for comments, or the study has decided for them. */
  canSortComments: z.boolean(),
  site: z.object({
    name: z.string(),
    logoUrl: z.string().nullable(),
    faviconUrl: z.string().nullable(),
    /** Whether the study has a page of community rules, at GET /rules. */
    hasRules: z.boolean(),
    /** Whether the site has its own terms of service and privacy policy, at GET /site/{page}. */
    hasTerms: z.boolean(),
    hasPrivacy: z.boolean(),
  }),
});

const flowRoute = createRoute({
  method: "get",
  path: "/me/flow",
  summary: "Which step of the study a participant is on",
  responses: {
    200: {
      description: "Their current step",
      content: { "application/json": { schema: flowStateSchema } },
    },
    401: {
      description: "Not signed in",
      content: { "application/json": { schema: errorSchema } },
    },
  },
});

const advanceRoute = createRoute({
  method: "post",
  path: "/me/flow/advance",
  summary: "Finish the current step and move on",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: actionMetaSchema.extend({
            /** The step they're finishing, so a double click can't skip one. */
            position: z.number().int().nonnegative(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description:
        "Moved on. When this finishes the study, they're out for good, and it says where to send them",
      content: {
        "application/json": {
          schema: z.object({ finished: z.boolean(), redirectUrl: z.string().nullable() }),
        },
      },
    },
    401: {
      description: "Not signed in",
      content: { "application/json": { schema: errorSchema } },
    },
    409: {
      description: "They aren't on that step, or can't leave it yet",
      content: { "application/json": { schema: errorSchema } },
    },
  },
});

const declineRoute = createRoute({
  method: "post",
  path: "/me/flow/decline",
  summary: "Decline consent, which works like withdrawing",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ position: z.number().int().nonnegative() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Their data is deleted, and this ID can't enter this study again",
      content: {
        "application/json": {
          schema: z.object({ message: z.string(), redirectUrl: z.string().nullable() }),
        },
      },
    },
    401: {
      description: "Not signed in",
      content: { "application/json": { schema: errorSchema } },
    },
    409: {
      description: "They aren't on a consent step",
      content: { "application/json": { schema: errorSchema } },
    },
  },
});

/** Timing the browser reports. Anything that changes state has its own route instead. */
const reportedEventSchema = z.discriminatedUnion("type", [
  actionMetaSchema.extend({
    type: z.literal("page.viewed"),
    payload: eventPayloadSchemas["page.viewed"],
  }),
  actionMetaSchema.extend({
    type: z.literal("decor.pressed"),
    payload: eventPayloadSchemas["decor.pressed"],
  }),
  actionMetaSchema.extend({
    type: z.literal("session.heartbeat"),
    payload: eventPayloadSchemas["session.heartbeat"],
  }),
  // From the app, through the page inside it (ADR 66).
  ...(["app.opened", "app.closed", "push.permission", "push.opened"] as const).map((type) =>
    actionMetaSchema.extend({ type: z.literal(type), payload: eventPayloadSchemas[type] }),
  ),
  actionMetaSchema.extend({
    type: z.literal("content.viewed"),
    payload: eventPayloadSchemas["content.viewed"],
    targetContentId: z.uuid(),
  }),
]);

const reportRoute = createRoute({
  method: "post",
  path: "/events",
  summary: "Report timing from the browser: pages viewed, time active, and time on content",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ events: z.array(reportedEventSchema).max(200) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Recorded. Repeats and content this participant can't see are ignored",
      content: { "application/json": { schema: z.object({ recorded: z.number() }) } },
    },
    401: {
      description: "Not signed in",
      content: { "application/json": { schema: errorSchema } },
    },
  },
});

const linkValues = ({ participantId, externalId }: ParticipantContext) => ({
  participantId,
  externalId,
});

/** Finishing is final (ADR 9): they're marked completed, and every session stops working. */
async function finishStudy(
  tx: Transaction,
  context: ParticipantContext,
  body: { clientEventId: string; occurredAt: string },
) {
  await recordEvent(tx, {
    type: "flow.exited",
    payload: { outcome: "completed" },
    worldId: context.worldId,
    studyVersionId: context.studyVersionId,
    participantId: context.participantId,
    conditionId: context.conditionId,
    actorId: context.actorId,
    source: "participant",
    occurredAt: new Date(body.occurredAt),
    clientEventId: body.clientEventId,
  });
  await tx
    .update(schema.participants)
    .set({ status: "completed" })
    .where(eq(schema.participants.id, context.participantId));
  await tx.delete(schema.sessions).where(eq(schema.sessions.participantId, context.participantId));
}

async function advance(
  db: Database,
  context: ParticipantContext,
  body: { position: number; clientEventId: string; occurredAt: string },
  now: Date,
): Promise<
  | { outcome: "conflict"; message: string }
  | { outcome: "moved"; finished: boolean; redirectUrl: string | null }
> {
  const elapsedMs = now.getTime() - context.worldStartedAt.getTime();
  const { settings } = context;
  const { step, position } = currentFlowStep(settings, context.flowPosition, elapsedMs);

  if (body.position !== position) {
    return { outcome: "conflict", message: "This step has already been completed." };
  }

  // A feed step they've reached the end of gets skipped by currentFlowStep, so this is only early.
  if (step?.step === "feed" && !canLeaveFeed(step, elapsedMs)) {
    return { outcome: "conflict", message: "It's not time to finish yet." };
  }

  const isLast = position >= settings.flow.length - 1;

  return db.transaction(async (tx) => {
    if (isLast || step === null) {
      await finishStudy(tx, context, body);
      const template = step?.step === "exit" ? step.redirect : undefined;
      return {
        outcome: "moved" as const,
        finished: true,
        redirectUrl: template
          ? fillLinkTemplate(template, linkValues(context))
          : await prolificFinishUrl(tx, context),
      };
    }

    await recordEvent(tx, {
      type: "flow.step_completed",
      payload: { step: step.step },
      worldId: context.worldId,
      studyVersionId: context.studyVersionId,
      participantId: context.participantId,
      conditionId: context.conditionId,
      actorId: context.actorId,
      source: "participant",
      occurredAt: new Date(body.occurredAt),
      clientEventId: body.clientEventId,
    });
    await tx
      .update(schema.participants)
      .set({ flowPosition: position + 1 })
      .where(eq(schema.participants.id, context.participantId));

    return { outcome: "moved" as const, finished: false, redirectUrl: null };
  });
}

export function createFlowRoutes({
  db,
  storage,
  mediaPublicUrl,
  clock = realClock,
}: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };

  app.openapi(flowRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }

    const [version] = await db
      .select({ pages: schema.studyVersions.pages })
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.id, context.studyVersionId));
    const pages = (version?.pages ?? {}) as Record<string, string>;

    const elapsedMs = clock().getTime() - context.worldStartedAt.getTime();
    const { step, position } = currentFlowStep(context.settings, context.flowPosition, elapsedMs);
    const { site } = context.settings;
    // A shared world waiting for people doesn't start anyone's study time until it does.
    const waiting =
      context.worldMode === "shared" && elapsedMs < 0
        ? {
            joined:
              (
                await db
                  .select({ total: count() })
                  .from(schema.worldMemberships)
                  .where(eq(schema.worldMemberships.worldId, context.worldId))
              )[0]?.total ?? 0,
            size: context.settings.worlds?.size ?? 0,
            startsBy: context.worldStartedAt.toISOString(),
          }
        : null;
    const feedSettings = feedSettingsFor(context.settings, context.conditionKey);

    return c.json(
      {
        step: step?.step ?? ("done" as const),
        position,
        pageText: step && "page" in step ? (pages[step.page] ?? "") : null,
        canFinish: step ? canLeaveFeed(step, elapsedMs) : false,
        ...(waiting ? { waiting } : {}),
        shared: context.worldMode === "shared",
        ...platformFor(context.settings, context.conditionKey),
        maxPostLength: maxPostLengthFor(context.settings, context.conditionKey),
        feedTabs: {
          home: feedSettings.homeTabLabel ?? "For you",
          following: feedSettings.followingTabLabel ?? "Following",
          startOnFollowing: feedSettings.startOnFollowing ?? false,
        },
        site: {
          name: site.name,
          logoUrl: site.logo ? mediaUrl(site.logo, mediaPublicUrl) : null,
          faviconUrl: site.favicon ? mediaUrl(site.favicon, mediaPublicUrl) : null,
          hasRules: Boolean(site.rules && pages[site.rules]),
          hasTerms: Boolean(site.terms && pages[site.terms]),
          hasPrivacy: Boolean(site.privacy && pages[site.privacy]),
        },
      },
      200,
    );
  });

  app.openapi(advanceRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }

    const result = await advance(db, context, c.req.valid("json"), clock());
    if (result.outcome === "conflict") {
      return c.json({ error: result.message }, 409);
    }
    return c.json({ finished: result.finished, redirectUrl: result.redirectUrl }, 200);
  });

  app.openapi(declineRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }

    const elapsedMs = clock().getTime() - context.worldStartedAt.getTime();
    const { step, position } = currentFlowStep(context.settings, context.flowPosition, elapsedMs);
    if (step?.step !== "consent" || c.req.valid("json").position !== position) {
      return c.json({ error: "This can't be declined now." }, 409);
    }

    // Worked out first, since deleting removes what they're based on.
    const redirectUrl = step.declineRedirect
      ? fillLinkTemplate(step.declineRedirect, linkValues(context))
      : await prolificDeclineUrl(db, context);
    await deleteParticipant(db, storage, context.participantId, "declined consent", "participant");
    deleteCookie(c, SESSION_COOKIE, { path: "/" });

    return c.json(
      {
        message: step.declineMessage ?? "You've chosen not to take part. You can close this page.",
        redirectUrl,
      },
      200,
    );
  });

  app.openapi(reportRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }

    const now = clock();
    const common = {
      worldId: context.worldId,
      studyVersionId: context.studyVersionId,
      participantId: context.participantId,
      conditionId: context.conditionId,
      actorId: context.actorId,
      source: "participant" as const,
    };

    let recorded = 0;
    for (const event of c.req.valid("json").events) {
      const meta = {
        ...common,
        occurredAt: new Date(event.occurredAt),
        clientEventId: event.clientEventId,
      };

      if (event.type === "content.viewed") {
        const visible = await findVisibleContent(db, context, event.targetContentId, now);
        if (!visible) {
          continue;
        }
        const stored = await db.transaction(async (tx) => {
          const result = await recordEvent(tx, {
            ...meta,
            type: event.type,
            payload: event.payload,
            targetContentId: event.targetContentId,
          });
          if (result) {
            await tx
              .insert(schema.contentInteractions)
              .values({
                worldId: context.worldId,
                actorId: context.actorId,
                contentId: event.targetContentId,
                kind: "view",
              })
              .onConflictDoNothing();
          }
          return result;
        });
        recorded += stored ? 1 : 0;
      } else if (event.type === "page.viewed") {
        const stored = await recordEvent(db, { ...meta, type: event.type, payload: event.payload });
        recorded += stored ? 1 : 0;
      } else {
        const stored = await recordEvent(db, { ...meta, type: event.type, payload: event.payload });
        recorded += stored ? 1 : 0;
      }
    }

    return c.json({ recorded }, 200);
  });

  return app;
}
