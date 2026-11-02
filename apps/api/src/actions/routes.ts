import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { feedPostSchema } from "@truman3/core";
import { type Database, recordEvent, schema, type Transaction } from "@truman3/db";
import { and, count, eq, isNull, or } from "drizzle-orm";
import { buildFeed, contentTimeMs, mediaUrl } from "../feed/build.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { type ParticipantContext, participantFromRequest } from "../participants/session.ts";
import { MAX_IMAGE_BYTES, storeUploadedImage } from "./images.ts";
import { listNotifications, scheduleReactions } from "./notifications.ts";
import { actionMetaSchema } from "./request.ts";

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const notSignedIn = errorResponse("Not signed in");
const okSchema = z.object({ ok: z.literal(true) });
const okResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: okSchema } },
});

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});

const toggleBodySchema = actionMetaSchema.extend({ active: z.boolean() });
const contentParams = z.object({ id: z.uuid() });

const likeRoute = createRoute({
  method: "post",
  path: "/content/{id}/like",
  summary: "Like or unlike a post or comment",
  request: { params: contentParams, ...jsonBody(toggleBodySchema) },
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    404: errorResponse("Not something this participant can see"),
  },
});

const flagRoute = createRoute({
  method: "post",
  path: "/content/{id}/flag",
  summary: "Flag or unflag a post or comment",
  request: { params: contentParams, ...jsonBody(toggleBodySchema) },
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    404: errorResponse("Not something this participant can see"),
  },
});

const commentRoute = createRoute({
  method: "post",
  path: "/content/{id}/comments",
  summary: "Comment on a post",
  request: {
    params: contentParams,
    ...jsonBody(actionMetaSchema.extend({ body: z.string().trim().min(1).max(5000) })),
  },
  responses: {
    200: {
      description: "Recorded. On a repeat of the same action, it returns the earlier comment",
      content: { "application/json": { schema: z.object({ id: z.uuid() }) } },
    },
    401: notSignedIn,
    404: errorResponse("Not a post this participant can see"),
  },
});

const postRoute = createRoute({
  method: "post",
  path: "/posts",
  summary: "Create a post, with text, an image, or both",
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: actionMetaSchema.extend({
            body: z.string().max(5000).default(""),
            image: z.instanceof(File).optional().openapi({ type: "string", format: "binary" }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Recorded. On a repeat of the same action, it returns the earlier post",
      content: { "application/json": { schema: z.object({ id: z.uuid() }) } },
    },
    400: errorResponse("No text or image, or the image can't be used"),
    401: notSignedIn,
  },
});

const relationActions = {
  follow: { kind: "follow", active: true, event: "actor.followed" },
  unfollow: { kind: "follow", active: false, event: "actor.unfollowed" },
  block: { kind: "block", active: true, event: "actor.blocked" },
  unblock: { kind: "block", active: false, event: "actor.unblocked" },
  report: { kind: "report", active: true, event: "actor.reported" },
} as const;

const relationRoute = createRoute({
  method: "post",
  path: "/actors/{username}/relation",
  summary: "Follow, unfollow, block, unblock, or report an actor",
  request: {
    params: z.object({ username: z.string() }),
    ...jsonBody(
      actionMetaSchema.extend({
        action: z.enum(["follow", "unfollow", "block", "unblock", "report"]),
        reason: z.string().max(500).optional(),
      }),
    ),
  },
  responses: {
    200: okResponse("Recorded"),
    400: errorResponse("A report needs a reason"),
    401: notSignedIn,
    404: errorResponse("No such actor"),
  },
});

const actorRoute = createRoute({
  method: "get",
  path: "/actors/{username}",
  summary: "An actor's profile and posts",
  request: { params: z.object({ username: z.string() }) },
  responses: {
    200: {
      description: "Their profile, how this participant relates to them, and their posts",
      content: {
        "application/json": {
          schema: z.object({
            username: z.string(),
            name: z.string(),
            bio: z.string(),
            location: z.string(),
            pictureUrl: z.string().nullable(),
            isViewer: z.boolean(),
            following: z.boolean(),
            blocked: z.boolean(),
            reported: z.boolean(),
            posts: z.array(feedPostSchema),
          }),
        },
      },
    },
    401: notSignedIn,
    404: errorResponse("No such actor"),
  },
});

const notificationsRoute = createRoute({
  method: "get",
  path: "/notifications",
  summary: "Reactions that have come due",
  responses: {
    200: {
      description: "Newest first",
      content: {
        "application/json": {
          schema: z.object({
            notifications: z.array(
              z.object({
                key: z.string(),
                type: z.enum(["read", "like", "reply"]),
                actors: z.array(
                  z.object({
                    username: z.string(),
                    name: z.string(),
                    pictureUrl: z.string().nullable(),
                  }),
                ),
                targetBody: z.string(),
                targetImageUrl: z.string().nullable(),
                replyBody: z.string().nullable(),
                at: z.iso.datetime(),
                unread: z.boolean(),
              }),
            ),
          }),
        },
      },
    },
    401: notSignedIn,
  },
});

const notificationsViewedRoute = createRoute({
  method: "post",
  path: "/notifications/viewed",
  summary: "Mark notifications as seen",
  request: jsonBody(actionMetaSchema),
  responses: { 200: okResponse("Recorded"), 401: notSignedIn },
});

const profileRoute = createRoute({
  method: "post",
  path: "/me/profile",
  summary: "Update the participant's profile",
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: actionMetaSchema.extend({
            username: z
              .string()
              .trim()
              .regex(/^[A-Za-z0-9_.-]{1,30}$/)
              .optional(),
            name: z.string().trim().max(100).optional(),
            bio: z.string().trim().max(500).optional(),
            location: z.string().trim().max(100).optional(),
            picture: z.instanceof(File).optional().openapi({ type: "string", format: "binary" }),
          }),
        },
      },
    },
  },
  responses: {
    200: okResponse("Saved"),
    400: errorResponse("The image can't be used"),
    401: notSignedIn,
    409: errorResponse("That username is taken"),
  },
});

/** Finds content this participant can act on: visible to them, now, in their world. */
async function findVisibleContent(
  db: Database,
  context: ParticipantContext,
  id: string,
  now: Date,
) {
  const [item] = await db
    .select()
    .from(schema.content)
    .where(
      and(
        eq(schema.content.id, id),
        eq(schema.content.studyVersionId, context.studyVersionId),
        or(isNull(schema.content.worldId), eq(schema.content.worldId, context.worldId)),
      ),
    );
  if (!item) {
    return null;
  }

  const appeared = contentTimeMs(item, context.worldStartedAt.getTime()) <= now.getTime();
  const inCondition =
    item.conditions.length === 0 || item.conditions.includes(context.conditionKey);
  return appeared && inCondition ? item : null;
}

/** An event for something the participant did, with the fields every such event shares. */
function participantEvent(context: ParticipantContext, occurredAt: string, clientEventId: string) {
  return {
    worldId: context.worldId,
    studyVersionId: context.studyVersionId,
    participantId: context.participantId,
    conditionId: context.conditionId,
    actorId: context.actorId,
    source: "participant" as const,
    occurredAt: new Date(occurredAt),
    clientEventId,
  };
}

/** Thrown inside a transaction to undo it when the action turns out to be a repeat. */
class RepeatedAction extends Error {}

/** If this action was already recorded, returns the content it created. */
async function findRepeat(db: Database | Transaction, worldId: string, clientEventId: string) {
  const [event] = await db
    .select({ contentId: schema.events.targetContentId })
    .from(schema.events)
    .where(and(eq(schema.events.worldId, worldId), eq(schema.events.clientEventId, clientEventId)));
  return event;
}

/** How many posts or comments this participant has made already, for their "nth". */
async function countOwnContent(tx: Transaction, context: ParticipantContext, kind: string) {
  const [row] = await tx
    .select({ total: count() })
    .from(schema.content)
    .where(
      and(
        eq(schema.content.worldId, context.worldId),
        eq(schema.content.authorActorId, context.actorId),
        eq(schema.content.kind, kind),
      ),
    );
  return row?.total ?? 0;
}

interface ProfileFields {
  name?: string;
  bio?: string;
  location?: string;
  picture?: string;
}

export function createActionRoutes({ db, storage, mediaPublicUrl }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();

  const pleaseSignIn = { error: "Please sign in." };
  const notAvailable = { error: "This isn't available." };

  /** Likes and flags work the same way: an event, plus the current state, together. */
  const toggle = (
    kind: "like" | "flag",
    onEvent: "content.liked" | "content.flagged",
    offEvent: "content.unliked" | "content.unflagged",
  ) => {
    return async (
      context: ParticipantContext,
      contentId: string,
      body: z.infer<typeof toggleBodySchema>,
    ) => {
      await db.transaction(async (tx) => {
        const recorded = await recordEvent(tx, {
          ...participantEvent(context, body.occurredAt, body.clientEventId),
          type: body.active ? onEvent : offEvent,
          payload: {},
          targetContentId: contentId,
        });
        if (!recorded) {
          return;
        }

        const row = { worldId: context.worldId, actorId: context.actorId, contentId, kind };
        if (body.active) {
          await tx.insert(schema.contentInteractions).values(row).onConflictDoNothing();
        } else {
          await tx
            .delete(schema.contentInteractions)
            .where(
              and(
                eq(schema.contentInteractions.worldId, context.worldId),
                eq(schema.contentInteractions.actorId, context.actorId),
                eq(schema.contentInteractions.contentId, contentId),
                eq(schema.contentInteractions.kind, kind),
              ),
            );
        }
      });
    };
  };
  const applyLike = toggle("like", "content.liked", "content.unliked");
  const applyFlag = toggle("flag", "content.flagged", "content.unflagged");

  app.openapi(likeRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    const { id } = c.req.valid("param");
    if (!(await findVisibleContent(db, context, id, new Date()))) {
      return c.json(notAvailable, 404);
    }
    await applyLike(context, id, c.req.valid("json"));
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(flagRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    const { id } = c.req.valid("param");
    if (!(await findVisibleContent(db, context, id, new Date()))) {
      return c.json(notAvailable, 404);
    }
    await applyFlag(context, id, c.req.valid("json"));
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(commentRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    const now = new Date();
    const { id: postId } = c.req.valid("param");
    const body = c.req.valid("json");

    const repeat = await findRepeat(db, context.worldId, body.clientEventId);
    if (repeat?.contentId) {
      return c.json({ id: repeat.contentId }, 200);
    }

    const post = await findVisibleContent(db, context, postId, now);
    if (post?.kind !== "post") {
      return c.json(notAvailable, 404);
    }

    try {
      const id = await db.transaction(async (tx) => {
        const nth = await countOwnContent(tx, context, "comment");
        const [created] = await tx
          .insert(schema.content)
          .values({
            studyVersionId: context.studyVersionId,
            worldId: context.worldId,
            parentId: postId,
            authorActorId: context.actorId,
            kind: "comment",
            body: body.body,
            visibleAt: now,
          })
          .returning({ id: schema.content.id });
        const contentId = created?.id as string;

        const recorded = await recordEvent(tx, {
          ...participantEvent(context, body.occurredAt, body.clientEventId),
          type: "content.created",
          payload: { kind: "comment" },
          targetContentId: contentId,
        });
        if (!recorded) {
          throw new RepeatedAction();
        }

        await scheduleReactions(tx, context, { on: "comment", nth, contentId, postId, now });
        return contentId;
      });
      return c.json({ id }, 200);
    } catch (error) {
      if (error instanceof RepeatedAction) {
        const earlier = await findRepeat(db, context.worldId, body.clientEventId);
        return c.json({ id: earlier?.contentId as string }, 200);
      }
      throw error;
    }
  });

  app.openapi(postRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    const now = new Date();
    const form = c.req.valid("form");
    const text = form.body.trim();

    const repeat = await findRepeat(db, context.worldId, form.clientEventId);
    if (repeat?.contentId) {
      return c.json({ id: repeat.contentId }, 200);
    }

    if (!text && !form.image) {
      return c.json({ error: "Add some text or a photo." }, 400);
    }

    let mediaKey: string | null = null;
    if (form.image) {
      mediaKey = await storeUploadedImage(storage, context.worldId, form.image);
      if (!mediaKey) {
        return c.json(
          {
            error: `That photo can't be used. Use a JPEG, PNG, GIF, or WebP under ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
          },
          400,
        );
      }
    }

    try {
      const id = await db.transaction(async (tx) => {
        const nth = await countOwnContent(tx, context, "post");
        const [created] = await tx
          .insert(schema.content)
          .values({
            studyVersionId: context.studyVersionId,
            worldId: context.worldId,
            authorActorId: context.actorId,
            kind: "post",
            body: text,
            mediaKey,
            visibleAt: now,
          })
          .returning({ id: schema.content.id });
        const contentId = created?.id as string;

        const recorded = await recordEvent(tx, {
          ...participantEvent(context, form.occurredAt, form.clientEventId),
          type: "content.created",
          payload: { kind: "post" },
          targetContentId: contentId,
        });
        if (!recorded) {
          throw new RepeatedAction();
        }

        await scheduleReactions(tx, context, {
          on: "post",
          nth,
          contentId,
          postId: contentId,
          now,
        });
        return contentId;
      });
      return c.json({ id }, 200);
    } catch (error) {
      if (error instanceof RepeatedAction) {
        const earlier = await findRepeat(db, context.worldId, form.clientEventId);
        return c.json({ id: earlier?.contentId as string }, 200);
      }
      throw error;
    }
  });

  /** Finds someone a participant can see: the cast, or themselves. */
  const findActor = async (context: ParticipantContext, username: string) => {
    const [actor] = await db
      .select()
      .from(schema.actors)
      .where(
        and(
          eq(schema.actors.studyVersionId, context.studyVersionId),
          eq(schema.actors.username, username),
          or(isNull(schema.actors.worldId), eq(schema.actors.worldId, context.worldId)),
        ),
      );
    return actor ?? null;
  };

  app.openapi(relationRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    const body = c.req.valid("json");
    const actor = await findActor(context, c.req.valid("param").username);
    if (!actor || actor.id === context.actorId) {
      return c.json(notAvailable, 404);
    }
    if (body.action === "report" && !body.reason) {
      return c.json({ error: "Please choose a reason." }, 400);
    }

    const { kind, active, event } = relationActions[body.action];
    await db.transaction(async (tx) => {
      const meta = {
        ...participantEvent(context, body.occurredAt, body.clientEventId),
        targetActorId: actor.id,
      };
      const recorded =
        event === "actor.reported"
          ? await recordEvent(tx, { ...meta, type: event, payload: { reason: body.reason ?? "" } })
          : await recordEvent(tx, { ...meta, type: event, payload: {} });
      if (!recorded) {
        return;
      }

      const row = {
        worldId: context.worldId,
        actorId: context.actorId,
        targetActorId: actor.id,
        kind,
      };
      if (active) {
        await tx.insert(schema.actorRelations).values(row).onConflictDoNothing();
      } else {
        await tx
          .delete(schema.actorRelations)
          .where(
            and(
              eq(schema.actorRelations.worldId, context.worldId),
              eq(schema.actorRelations.actorId, context.actorId),
              eq(schema.actorRelations.targetActorId, actor.id),
              eq(schema.actorRelations.kind, kind),
            ),
          );
      }
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(actorRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    const actor = await findActor(context, c.req.valid("param").username);
    if (!actor) {
      return c.json(notAvailable, 404);
    }

    const relations = await db
      .select({ kind: schema.actorRelations.kind })
      .from(schema.actorRelations)
      .where(
        and(
          eq(schema.actorRelations.worldId, context.worldId),
          eq(schema.actorRelations.actorId, context.actorId),
          eq(schema.actorRelations.targetActorId, actor.id),
        ),
      );
    const has = (kind: string) => relations.some((relation) => relation.kind === kind);

    const posts = await buildFeed({ db, mediaPublicUrl }, context, {
      surface: "profile",
      authorActorId: actor.id,
      // A profile shows all of someone's posts, newest first, whatever the feed's rules are.
      settings: {
        ranker: "chronological",
        removeFlagged: context.settings.feed.removeFlagged,
        removeBlocked: false,
      },
    });

    const profile = actor.profile as ProfileFields;
    return c.json(
      {
        username: actor.username,
        name: profile.name ?? actor.username,
        bio: profile.bio ?? "",
        location: profile.location ?? "",
        pictureUrl: profile.picture ? mediaUrl(profile.picture, mediaPublicUrl) : null,
        isViewer: actor.id === context.actorId,
        following: has("follow"),
        blocked: has("block"),
        reported: has("report"),
        posts,
      },
      200,
    );
  });

  app.openapi(notificationsRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    return c.json({ notifications: await listNotifications(db, context, mediaPublicUrl) }, 200);
  });

  app.openapi(notificationsViewedRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    const body = c.req.valid("json");
    await db.transaction(async (tx) => {
      const recorded = await recordEvent(tx, {
        ...participantEvent(context, body.occurredAt, body.clientEventId),
        type: "notifications.viewed",
        payload: {},
      });
      if (recorded) {
        await tx
          .update(schema.worldMemberships)
          .set({ notificationsViewedAt: new Date() })
          .where(
            and(
              eq(schema.worldMemberships.worldId, context.worldId),
              eq(schema.worldMemberships.participantId, context.participantId),
            ),
          );
      }
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(profileRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    const form = c.req.valid("form");

    let picture: string | undefined;
    if (form.picture) {
      const key = await storeUploadedImage(storage, context.worldId, form.picture);
      if (!key) {
        return c.json({ error: "That photo can't be used." }, 400);
      }
      picture = key;
    }

    if (form.username) {
      const taken = await findActor(context, form.username);
      if (taken && taken.id !== context.actorId) {
        return c.json({ error: "That username is taken." }, 409);
      }
    }

    const [actor] = await db
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.id, context.actorId));
    const changes = {
      ...(form.name === undefined ? {} : { name: form.name }),
      ...(form.bio === undefined ? {} : { bio: form.bio }),
      ...(form.location === undefined ? {} : { location: form.location }),
      ...(picture === undefined ? {} : { picture }),
    };

    await db.transaction(async (tx) => {
      const recorded = await recordEvent(tx, {
        ...participantEvent(context, form.occurredAt, form.clientEventId),
        type: "profile.updated",
        payload: {
          fields: [...Object.keys(changes), ...(form.username ? ["username"] : [])],
        },
      });
      if (recorded) {
        await tx
          .update(schema.actors)
          .set({
            profile: { ...(actor?.profile as ProfileFields), ...changes },
            ...(form.username ? { username: form.username } : {}),
          })
          .where(eq(schema.actors.id, context.actorId));
      }
    });
    return c.json({ ok: true as const }, 200);
  });

  return app;
}
