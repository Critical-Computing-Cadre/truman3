import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  type Attachment,
  checkNewPost,
  type FeatureKey,
  featureOn,
  feedPostSchema,
  feedWarningSchema,
  MAX_ATTACHMENTS,
  MAX_LINK_LENGTH,
  MAX_REPLY_DEPTH,
  MAX_TITLE_LENGTH,
  modLogEntrySchema,
  POST_TAGS,
  type PostTag,
  platformStyleFor,
  pollOptionsProblem,
  safeLink,
} from "@truman3/core";
import { type Database, recordEvent, schema, type Transaction } from "@truman3/db";
import { and, count, eq, inArray, isNull, lte, or } from "drizzle-orm";
import {
  buildFeed,
  castKarma,
  contentTimeMs,
  hiddenByBan,
  loadBans,
  loadRemovals,
  loadSpacesFor,
  mediaUrl,
  participantKarma,
} from "../feed/build.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { type ParticipantContext, participantFromRequest } from "../participants/session.ts";
import { MAX_IMAGE_BYTES, storeUploadedImage } from "./images.ts";
import { listModLog, listWarnings } from "./moderation.ts";
import {
  listNotifications,
  scheduleFlagAnswer,
  scheduleReactions,
  scheduleReportAnswer,
} from "./notifications.ts";
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
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("Not something this participant can see"),
  },
});

const voteRoute = createRoute({
  method: "post",
  path: "/content/{id}/vote",
  summary: "Vote a post or comment up or down, or take a vote back",
  request: {
    params: contentParams,
    ...jsonBody(actionMetaSchema.extend({ value: z.enum(["up", "down"]).nullable() })),
  },
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
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
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("Not something this participant can see"),
  },
});

const commentRoute = createRoute({
  method: "post",
  path: "/content/{id}/comments",
  summary: "Comment on a post, or with threads, reply to a comment",
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
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("Nothing this participant can see or reply to"),
  },
});

const saveRoute = createRoute({
  method: "post",
  path: "/content/{id}/save",
  summary: "Save a post to this person's list, or take it off",
  request: { params: contentParams, ...jsonBody(toggleBodySchema) },
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("Not a post this participant can see"),
  },
});

const hideRoute = createRoute({
  method: "post",
  path: "/content/{id}/hide",
  summary: "Hide a post from this person's feeds, or bring it back",
  request: { params: contentParams, ...jsonBody(toggleBodySchema) },
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("Not a post this participant can see"),
  },
});

const shareRoute = createRoute({
  method: "post",
  path: "/content/{id}/share",
  summary: "Record that someone copied a link to a post",
  request: {
    params: contentParams,
    ...jsonBody(actionMetaSchema.extend({ method: z.enum(["copy"]) })),
  },
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("Not a post this participant can see"),
  },
});

const linkOpenedRoute = createRoute({
  method: "post",
  path: "/content/{id}/link-opened",
  summary: "Record that someone clicked the link on a post",
  request: { params: contentParams, ...jsonBody(actionMetaSchema) },
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("Not a linked post this participant can see"),
  },
});

const revealRoute = createRoute({
  method: "post",
  path: "/content/{id}/reveal",
  summary: "Record that someone uncovered a tagged post",
  request: { params: contentParams, ...jsonBody(actionMetaSchema) },
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    404: errorResponse("Not a covered post this participant can see"),
  },
});

const pollVoteRoute = createRoute({
  method: "post",
  path: "/content/{id}/poll",
  summary: "Choose an option in a post's poll, once",
  request: {
    params: contentParams,
    ...jsonBody(actionMetaSchema.extend({ option: z.number().int().nonnegative() })),
  },
  responses: {
    200: okResponse("Recorded"),
    400: errorResponse("That isn't one of its options"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("Not a post with a poll this participant can see"),
    409: errorResponse("They've already chosen, and can't change it"),
  },
});

const crosspostRoute = createRoute({
  method: "post",
  path: "/content/{id}/crosspost",
  summary: "Share a post into another space, as a new post that shows where it came from",
  request: {
    params: contentParams,
    ...jsonBody(
      actionMetaSchema.extend({
        /** The key of the space it goes in. They have to have joined it. */
        space: z.string(),
        /** Leave this out to use the original's title. */
        title: z.string().max(MAX_TITLE_LENGTH).optional(),
        flair: z.string().optional(),
      }),
    ),
  },
  responses: {
    200: {
      description: "Recorded. On a repeat of the same action, it returns the earlier post",
      content: { "application/json": { schema: z.object({ id: z.uuid() }) } },
    },
    400: errorResponse("It's already in that space, or it's missing a title or flair"),
    401: notSignedIn,
    403: errorResponse("That feature is off, or they aren't in that space"),
    404: errorResponse("No such post or space for this participant"),
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
            /** Required on a platform with titles, and refused on one without. */
            title: z.string().max(MAX_TITLE_LENGTH).optional(),
            body: z.string().max(5000).default(""),
            /** The key of the space it goes in, on a platform with spaces. */
            space: z.string().optional(),
            /** Where it links to, on a platform with link posts. */
            link: z.string().max(MAX_LINK_LENGTH).optional(),
            /** Whether to cover it, on a platform with these tags. */
            spoiler: z.stringbool().optional(),
            adult: z.stringbool().optional(),
            /** Repeat this field for each option, on a platform with polls. */
            pollOption: z.union([z.string(), z.array(z.string())]).optional(),
            /** A label from its space's list, on a platform with flair. */
            flair: z.string().optional(),
            /** Repeat this field for several photos, on a platform with galleries. */
            image: z
              .union([z.instanceof(File), z.array(z.instanceof(File))])
              .optional()
              .openapi({ type: "string", format: "binary" }),
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
    400: errorResponse("It doesn't fit this platform's style, or the image can't be used"),
    404: errorResponse("No such space for this participant"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
  },
});

const relationActions = {
  follow: { kind: "follow", active: true, event: "actor.followed" },
  unfollow: { kind: "follow", active: false, event: "actor.unfollowed" },
  block: { kind: "block", active: true, event: "actor.blocked" },
  unblock: { kind: "block", active: false, event: "actor.unblocked" },
  report: { kind: "report", active: true, event: "actor.reported" },
} as const;

const RELATION_FEATURES = { follow: "following", block: "blocking", report: "reporting" } as const;

const featureOff = { error: "This isn't part of this platform." };

/** Hiding a button isn't enough, so the server refuses whatever's off in this person's condition. */
const isOff = (context: ParticipantContext, feature: FeatureKey) =>
  !featureOn(context.settings, context.conditionKey, feature);

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
    403: errorResponse("That feature is off in this condition"),
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
            /** Where a moderator has banned them. */
            bans: z.array(
              z.object({
                by: z.string(),
                reason: z.string().optional(),
                space: z.string().optional(),
              }),
            ),
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
                type: z.enum(["read", "like", "reply", "remove", "warn", "answer", "ban"]),
                actors: z.array(
                  z.object({
                    username: z.string(),
                    name: z.string(),
                    pictureUrl: z.string().nullable(),
                  }),
                ),
                targetIsTheirs: z.boolean(),
                targetKind: z.enum(["post", "comment", "person"]),
                targetName: z.string(),
                /** The post this is about, for a link to its own page. */
                postId: z.string().nullable(),
                /** The comment to go to there, if it's about one. */
                commentId: z.string().nullable(),
                targetBody: z.string(),
                targetImageUrl: z.string().nullable(),
                replyBody: z.string().nullable(),
                reason: z.string().nullable(),
                at: z.iso.datetime(),
                unread: z.boolean(),
              }),
            ),
          }),
        },
      },
    },
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
  },
});

const openRoute = createRoute({
  method: "post",
  path: "/content/{id}/open",
  summary: "Record that someone opened a post's own page",
  request: {
    params: contentParams,
    ...jsonBody(actionMetaSchema.extend({ from: z.string().trim().min(1).max(30) })),
  },
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("Not something this participant can see"),
  },
});

const warningsRoute = createRoute({
  method: "get",
  path: "/warnings",
  summary: "A moderator's warnings this person hasn't acknowledged yet",
  responses: {
    200: {
      description: "Oldest first",
      content: {
        "application/json": { schema: z.object({ warnings: z.array(feedWarningSchema) }) },
      },
    },
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
  },
});

const acknowledgeWarningRoute = createRoute({
  method: "post",
  path: "/warnings/{id}/acknowledge",
  summary: "Acknowledge a moderator's warning",
  request: { params: contentParams, ...jsonBody(actionMetaSchema) },
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("Not one of this person's warnings"),
  },
});

const modLogRoute = createRoute({
  method: "get",
  path: "/mod-log",
  summary: "What moderators have removed so far, newest first",
  request: { query: z.object({ space: z.string().optional() }) },
  responses: {
    200: {
      description: "Newest first",
      content: {
        "application/json": { schema: z.object({ entries: z.array(modLogEntrySchema) }) },
      },
    },
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
  },
});

const notificationsViewedRoute = createRoute({
  method: "post",
  path: "/notifications/viewed",
  summary: "Mark notifications as seen",
  request: jsonBody(actionMetaSchema),
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
  },
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
export async function findVisibleContent(
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

  const worldStartMs = context.worldStartedAt.getTime();
  const appeared = contentTimeMs(item, worldStartMs) <= now.getTime();
  // Someone banned stops appearing to post, so what they'd have written can't be reached by its ID.
  const bans = await loadBans(db, context, now);
  if (bans.length > 0) {
    const chain = [item];
    for (let above = item; above.parentId; ) {
      const [parent] = await db
        .select()
        .from(schema.content)
        .where(eq(schema.content.id, above.parentId));
      if (!parent) {
        break;
      }
      chain.push(parent);
      above = parent;
    }
    if (hiddenByBan(item, new Map(chain.map((row) => [row.id, row])), bans, worldStartMs)) {
      return null;
    }
  }
  // A space a condition can't see hides its posts too, as it does in the feed.
  if (item.spaceId && featureOn(context.settings, context.conditionKey, "spaces")) {
    const spaces = await loadSpacesFor(db, context);
    if (!spaces.some(({ id: spaceId }) => spaceId === item.spaceId)) {
      return null;
    }
  }

  const inCondition =
    item.conditions.length === 0 || item.conditions.includes(context.conditionKey);
  return appeared && inCondition ? item : null;
}

/** Whether all of a thread above this is visible, and it isn't already as deep as threads go. */
async function canReplyUnder(
  db: Database,
  context: ParticipantContext,
  target: NonNullable<Awaited<ReturnType<typeof findVisibleContent>>>,
  now: Date,
) {
  let current = target;
  for (let depth = 0; current.parentId; depth++) {
    const parent = await findVisibleContent(db, context, current.parentId, now);
    if (!parent || depth + 1 >= MAX_REPLY_DEPTH) {
      return false;
    }
    current = parent;
  }
  return true;
}

/** An event for something the participant did, with the fields every such event shares. */
export function participantEvent(
  context: ParticipantContext,
  occurredAt: string,
  clientEventId: string,
) {
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

/** Thrown inside a transaction to undo it when someone has already chosen in a poll. */
class AlreadyVoted extends Error {}

/**
 * Whether a post can go in this space with this flair, as a message if not. A space's list and its
 * requirement only apply where flair is on, and a post outside a space can't have any.
 */
function flairProblem(
  context: ParticipantContext,
  space: { postFlair: readonly { text: string }[]; requirePostFlair: boolean } | undefined,
  flair: string,
): string | null {
  if (isOff(context, "flair")) {
    return null;
  }
  if (flair && !space?.postFlair.some(({ text }) => text === flair)) {
    return "That flair isn't one this community offers.";
  }
  return !flair && space?.requirePostFlair ? "This community requires flair on posts." : null;
}

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
  karma?: number;
}

export function createActionRoutes({ db, storage, mediaPublicUrl }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();

  const pleaseSignIn = { error: "Please sign in." };
  const notAvailable = { error: "This isn't available." };

  /** Likes and flags work the same way: an event, plus the current state, together. */
  const toggle = (
    kind: "like" | "flag" | "save" | "hide",
    onEvent: "content.liked" | "content.flagged" | "content.saved" | "content.hidden",
    offEvent: "content.unliked" | "content.unflagged" | "content.unsaved" | "content.unhidden",
  ) => {
    return async (
      context: ParticipantContext,
      contentId: string,
      body: z.infer<typeof toggleBodySchema>,
      /** Anything else that happens with this, the first time it's recorded. */
      alsoDo?: (tx: Transaction) => Promise<void>,
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
        await alsoDo?.(tx);
      });
    };
  };
  const applyLike = toggle("like", "content.liked", "content.unliked");
  const applyFlag = toggle("flag", "content.flagged", "content.unflagged");
  const applySave = toggle("save", "content.saved", "content.unsaved");
  const applyHide = toggle("hide", "content.hidden", "content.unhidden");

  const wasRemoved = { error: "A moderator removed this." };
  /** Whether a moderator has taken this down, as far as this person is concerned, by now. */
  const isRemoved = async (context: ParticipantContext, id: string) =>
    (await loadRemovals(db, context, new Date())).has(id);

  /** Where a moderator has banned someone, for their profile. */
  const bansOf = async (context: ParticipantContext, actorId: string) => {
    const mine = (await loadBans(db, context, new Date())).filter(
      ({ bannedActorId }) => bannedActorId === actorId,
    );
    if (mine.length === 0) {
      return [];
    }
    const spaces = new Map((await loadSpacesFor(db, context)).map((space) => [space.id, space]));
    const moderators = await db
      .select()
      .from(schema.actors)
      .where(inArray(schema.actors.id, [...new Set(mine.map((ban) => ban.actorId))]));
    return mine.flatMap(({ actorId: moderatorId, reason, spaceId }) => {
      const space = spaceId ? spaces.get(spaceId) : undefined;
      if (spaceId && !space) {
        return [];
      }
      const moderator = moderators.find(({ id }) => id === moderatorId);
      return [
        {
          by: (moderator?.profile as ProfileFields | undefined)?.name ?? moderator?.username ?? "",
          ...(reason ? { reason } : {}),
          ...(space ? { space: space.name } : {}),
        },
      ];
    });
  };

  /** The post this acts on, if it's a post this person can see. */
  const visiblePost = async (context: ParticipantContext, id: string) => {
    const item = await findVisibleContent(db, context, id, new Date());
    return item?.kind === "post" ? item : null;
  };

  app.openapi(saveRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "saving")) {
      return c.json(featureOff, 403);
    }
    const { id } = c.req.valid("param");
    if (!(await visiblePost(context, id))) {
      return c.json(notAvailable, 404);
    }
    await applySave(context, id, c.req.valid("json"));
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(hideRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "hiding")) {
      return c.json(featureOff, 403);
    }
    const { id } = c.req.valid("param");
    if (!(await visiblePost(context, id))) {
      return c.json(notAvailable, 404);
    }
    await applyHide(context, id, c.req.valid("json"));
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(shareRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "sharing")) {
      return c.json(featureOff, 403);
    }
    const { id } = c.req.valid("param");
    if (!(await visiblePost(context, id))) {
      return c.json(notAvailable, 404);
    }
    const body = c.req.valid("json");
    await recordEvent(db, {
      ...participantEvent(context, body.occurredAt, body.clientEventId),
      type: "content.shared",
      payload: { method: body.method },
      targetContentId: id,
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(linkOpenedRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "links")) {
      return c.json(featureOff, 403);
    }
    const { id } = c.req.valid("param");
    const item = await visiblePost(context, id);
    if (!item?.linkUrl) {
      return c.json(notAvailable, 404);
    }
    const body = c.req.valid("json");
    await recordEvent(db, {
      ...participantEvent(context, body.occurredAt, body.clientEventId),
      type: "content.link_opened",
      payload: {},
      targetContentId: id,
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(revealRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    const { id } = c.req.valid("param");
    const item = await visiblePost(context, id);
    // Only what actually covered it here, so the record can't say more than they saw.
    // A crosspost shows its original, so it's covered by whatever covers that too.
    const original =
      item?.crosspostOf && !isOff(context, "crossposting")
        ? await findVisibleContent(db, context, item.crosspostOf, new Date())
        : null;
    const tags = [...new Set([...(item?.tags ?? []), ...(original?.tags ?? [])])].filter(
      (tag) =>
        (tag === "spoiler" && !isOff(context, "spoilers")) ||
        (tag === "adult" && !isOff(context, "adultTags")),
    ) as PostTag[];
    if (tags.length === 0) {
      return c.json(notAvailable, 404);
    }
    const body = c.req.valid("json");
    await recordEvent(db, {
      ...participantEvent(context, body.occurredAt, body.clientEventId),
      type: "content.revealed",
      payload: { tags },
      targetContentId: id,
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(pollVoteRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "polls")) {
      return c.json(featureOff, 403);
    }
    const { id: contentId } = c.req.valid("param");
    const item = await visiblePost(context, contentId);
    if (!item?.poll) {
      return c.json(notAvailable, 404);
    }
    if (await isRemoved(context, contentId)) {
      return c.json(wasRemoved, 403);
    }
    const body = c.req.valid("json");
    if (body.option >= item.poll.options.length) {
      return c.json({ error: "That isn't one of its options." }, 400);
    }
    try {
      await db.transaction(async (tx) => {
        const recorded = await recordEvent(tx, {
          ...participantEvent(context, body.occurredAt, body.clientEventId),
          type: "content.poll_voted",
          payload: { option: body.option },
          targetContentId: contentId,
        });
        if (!recorded) {
          return;
        }
        const inserted = await tx
          .insert(schema.contentInteractions)
          .values({
            worldId: context.worldId,
            actorId: context.actorId,
            contentId,
            kind: "poll",
            pollOption: body.option,
          })
          .onConflictDoNothing()
          .returning({ contentId: schema.contentInteractions.contentId });
        if (inserted.length === 0) {
          throw new AlreadyVoted();
        }
      });
    } catch (error) {
      if (error instanceof AlreadyVoted) {
        return c.json({ error: "You've already voted in this poll." }, 409);
      }
      throw error;
    }
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(crosspostRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "crossposting") || isOff(context, "posting") || isOff(context, "spaces")) {
      return c.json(featureOff, 403);
    }
    const now = new Date();
    const body = c.req.valid("json");

    const repeat = await findRepeat(db, context.worldId, body.clientEventId);
    if (repeat?.contentId) {
      return c.json({ id: repeat.contentId }, 200);
    }

    const { id: targetId } = c.req.valid("param");
    const target = await visiblePost(context, targetId);
    // A crosspost of a crosspost points at the first post, so nobody has to follow a chain.
    const original = target?.crosspostOf
      ? await findVisibleContent(db, context, target.crosspostOf, now)
      : target;
    if (!target || !original) {
      return c.json(notAvailable, 404);
    }
    const removals = await loadRemovals(db, context, now);
    if (removals.has(target.id) || removals.has(original.id)) {
      return c.json(wasRemoved, 403);
    }

    const space = (await loadSpacesFor(db, context)).find(({ key }) => key === body.space);
    if (!space) {
      return c.json(notAvailable, 404);
    }
    if (!space.joined) {
      return c.json({ error: "Join this community first." }, 403);
    }
    if (space.id === original.spaceId || space.id === target.spaceId) {
      return c.json({ error: "This post is already in that community." }, 400);
    }
    const flair = body.flair?.trim() ?? "";
    const problem = flairProblem(context, space, flair);
    if (problem) {
      return c.json({ error: problem }, 400);
    }
    const title = isOff(context, "titles") ? "" : body.title?.trim() || original.title || "";
    if (!title && !isOff(context, "titles")) {
      return c.json({ error: "Give your post a title." }, 400);
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
            ...(title ? { title } : {}),
            ...(flair ? { flair } : {}),
            crosspostOf: original.id,
            spaceId: space.id,
            visibleAt: now,
          })
          .returning({ id: schema.content.id });
        const contentId = created?.id as string;

        const recorded = await recordEvent(tx, {
          ...participantEvent(context, body.occurredAt, body.clientEventId),
          type: "content.created",
          payload: { kind: "post", crosspostOf: original.id },
          targetContentId: contentId,
        });
        if (!recorded) {
          throw new RepeatedAction();
        }

        await scheduleReactions(tx, context, {
          on: "post",
          nth,
          contentId,
          replyUnderId: contentId,
          spaceId: space.id,
          now,
        });
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

  app.openapi(likeRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "likes")) {
      return c.json(featureOff, 403);
    }
    const { id } = c.req.valid("param");
    if (!(await findVisibleContent(db, context, id, new Date()))) {
      return c.json(notAvailable, 404);
    }
    if (await isRemoved(context, id)) {
      return c.json(wasRemoved, 403);
    }
    await applyLike(context, id, c.req.valid("json"));
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(openRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "postPages")) {
      return c.json(featureOff, 403);
    }
    const { id: contentId } = c.req.valid("param");
    if (!(await findVisibleContent(db, context, contentId, new Date()))) {
      return c.json(notAvailable, 404);
    }
    const body = c.req.valid("json");
    await recordEvent(db, {
      ...participantEvent(context, body.occurredAt, body.clientEventId),
      type: "content.opened",
      payload: { from: body.from },
      targetContentId: contentId,
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(voteRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "votes")) {
      return c.json(featureOff, 403);
    }
    const { id: contentId } = c.req.valid("param");
    if (!(await findVisibleContent(db, context, contentId, new Date()))) {
      return c.json(notAvailable, 404);
    }
    if (await isRemoved(context, contentId)) {
      return c.json(wasRemoved, 403);
    }
    const body = c.req.valid("json");
    await db.transaction(async (tx) => {
      const recorded = await recordEvent(tx, {
        ...participantEvent(context, body.occurredAt, body.clientEventId),
        type: "content.voted",
        payload: { value: body.value },
        targetContentId: contentId,
      });
      if (!recorded) {
        return;
      }
      // Someone has one vote at a time, so a new one replaces the old.
      await tx
        .delete(schema.contentInteractions)
        .where(
          and(
            eq(schema.contentInteractions.worldId, context.worldId),
            eq(schema.contentInteractions.actorId, context.actorId),
            eq(schema.contentInteractions.contentId, contentId),
            inArray(schema.contentInteractions.kind, ["up", "down"]),
          ),
        );
      if (body.value) {
        await tx.insert(schema.contentInteractions).values({
          worldId: context.worldId,
          actorId: context.actorId,
          contentId,
          kind: body.value,
        });
      }
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(flagRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "flagging")) {
      return c.json(featureOff, 403);
    }
    const { id } = c.req.valid("param");
    const now = new Date();
    const target = await findVisibleContent(db, context, id, now);
    if (!target) {
      return c.json(notAvailable, 404);
    }
    if (await isRemoved(context, id)) {
      return c.json(wasRemoved, 403);
    }
    const body = c.req.valid("json");
    await applyFlag(context, id, body, async (tx) => {
      if (body.active) {
        await scheduleFlagAnswer(tx, context, target, now);
      }
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(commentRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "comments")) {
      return c.json(featureOff, 403);
    }
    const now = new Date();
    const { id: targetId } = c.req.valid("param");
    const body = c.req.valid("json");

    const repeat = await findRepeat(db, context.worldId, body.clientEventId);
    if (repeat?.contentId) {
      return c.json({ id: repeat.contentId }, 200);
    }

    const target = await findVisibleContent(db, context, targetId, now);
    if (!target) {
      return c.json(notAvailable, 404);
    }
    if (target.kind === "comment" && isOff(context, "threads")) {
      return c.json(featureOff, 403);
    }
    if (!(await canReplyUnder(db, context, target, now))) {
      return c.json(notAvailable, 404);
    }
    let topPost = target;
    while (topPost.parentId) {
      const parent = await findVisibleContent(db, context, topPost.parentId, now);
      if (!parent) {
        return c.json(notAvailable, 404);
      }
      topPost = parent;
    }
    // Nobody can add to something a moderator took down, or to the post it's on.
    const removals = await loadRemovals(db, context, now);
    if (removals.size > 0) {
      let above: typeof target | null = target;
      while (above) {
        if (removals.has(above.id)) {
          return c.json(wasRemoved, 403);
        }
        above = above.parentId ? await findVisibleContent(db, context, above.parentId, now) : null;
      }
    }
    if (!isOff(context, "locking")) {
      let top: typeof target | null = target;
      while (top?.parentId) {
        top = await findVisibleContent(db, context, top.parentId, now);
      }
      if (top?.locked) {
        return c.json({ error: "This post is locked." }, 403);
      }
    }

    try {
      const id = await db.transaction(async (tx) => {
        const nth = await countOwnContent(tx, context, "comment");
        const [created] = await tx
          .insert(schema.content)
          .values({
            studyVersionId: context.studyVersionId,
            worldId: context.worldId,
            parentId: targetId,
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

        await scheduleReactions(tx, context, {
          on: "comment",
          nth,
          contentId,
          // Without threads, a comment is always on a post, and a scripted reply goes on it too.
          replyUnderId: isOff(context, "threads") ? targetId : contentId,
          spaceId: topPost.spaceId,
          now,
        });
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
    if (isOff(context, "posting")) {
      return c.json(featureOff, 403);
    }
    const now = new Date();
    const form = c.req.valid("form");
    const text = form.body.trim();

    const repeat = await findRepeat(db, context.worldId, form.clientEventId);
    if (repeat?.contentId) {
      return c.json({ id: repeat.contentId }, 200);
    }

    const rawLink = form.link?.trim() ?? "";
    if (rawLink && isOff(context, "links")) {
      return c.json(featureOff, 403);
    }
    const link = rawLink ? safeLink(rawLink) : null;
    if (rawLink && !link) {
      return c.json(
        { error: "A link has to be a full address, starting with http or https." },
        400,
      );
    }
    if (
      (form.spoiler && isOff(context, "spoilers")) ||
      (form.adult && isOff(context, "adultTags"))
    ) {
      return c.json(featureOff, 403);
    }
    const tags = POST_TAGS.filter((tag) => form[tag]);

    const pollOptions = [form.pollOption ?? []]
      .flat()
      .map((option) => option.trim())
      .filter(Boolean);
    if (pollOptions.length > 0 && isOff(context, "polls")) {
      return c.json(featureOff, 403);
    }
    const pollProblem = pollOptions.length > 0 ? pollOptionsProblem(pollOptions) : null;
    if (pollProblem) {
      return c.json({ error: pollProblem }, 400);
    }
    const flair = form.flair?.trim() ?? "";
    if (flair && isOff(context, "flair")) {
      return c.json(featureOff, 403);
    }

    const images = [form.image ?? []].flat();
    const problem = checkNewPost(
      platformStyleFor(context.settings, context.conditionKey),
      text.length > 0,
      images.length > 0,
      {
        titled: !isOff(context, "titles") && (form.title?.trim() ?? "").length > 0,
        linked: link !== null,
        polled: pollOptions.length > 0,
      },
    );
    if (problem) {
      return c.json({ error: problem }, 400);
    }

    if (images.length > 1 && isOff(context, "galleries")) {
      return c.json(featureOff, 403);
    }
    const title = form.title?.trim() ?? "";
    if (title && isOff(context, "titles")) {
      return c.json(featureOff, 403);
    }
    if (!title && !isOff(context, "titles")) {
      return c.json({ error: "Give your post a title." }, 400);
    }
    if (images.length > MAX_ATTACHMENTS) {
      return c.json({ error: `A post can have up to ${MAX_ATTACHMENTS} photos.` }, 400);
    }

    let space: Awaited<ReturnType<typeof loadSpacesFor>>[number] | undefined;
    if (form.space) {
      if (isOff(context, "spaces")) {
        return c.json(featureOff, 403);
      }
      space = (await loadSpacesFor(db, context)).find(({ key }) => key === form.space);
      if (!space) {
        return c.json(notAvailable, 404);
      }
    }
    const flairTrouble = flairProblem(context, space, flair);
    if (flairTrouble) {
      return c.json({ error: flairTrouble }, 400);
    }

    const attachments: Attachment[] = [];
    for (const image of images) {
      const key = await storeUploadedImage(storage, context.worldId, context.participantId, image);
      if (!key) {
        return c.json(
          {
            error: `That photo can't be used. Use a JPEG, PNG, GIF, or WebP under ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
          },
          400,
        );
      }
      attachments.push({ type: "image", key });
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
            ...(title ? { title } : {}),
            ...(link ? { linkUrl: link } : {}),
            tags,
            ...(pollOptions.length > 0
              ? {
                  poll: {
                    options: pollOptions.map((option) => ({ text: option, votes: 0 })),
                    resultsFirst: false,
                  },
                }
              : {}),
            ...(flair ? { flair } : {}),
            body: text,
            attachments,
            spaceId: space?.id,
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
          replyUnderId: contentId,
          spaceId: space?.id ?? null,
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
    if (isOff(context, RELATION_FEATURES[relationActions[body.action].kind])) {
      return c.json(featureOff, 403);
    }
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
      if (body.action === "report") {
        await scheduleReportAnswer(tx, context, actor.id, new Date());
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
        reshuffleEachVisit: false,
        removeFlagged: context.settings.feed.removeFlagged,
        removeBlocked: false,
      },
    });

    const profile = actor.profile as ProfileFields;
    const karma = isOff(context, "karma")
      ? {}
      : {
          karma:
            actor.id === context.actorId
              ? await participantKarma(db, context)
              : castKarma(
                  context.settings,
                  context.conditionKey,
                  actor.username,
                  profile.karma,
                  Date.now() - context.worldStartedAt.getTime(),
                ),
        };
    return c.json(
      {
        ...karma,
        username: actor.username,
        name: profile.name ?? actor.username,
        bio: profile.bio ?? "",
        location: profile.location ?? "",
        pictureUrl: profile.picture ? mediaUrl(profile.picture, mediaPublicUrl) : null,
        isViewer: actor.id === context.actorId,
        following: has("follow"),
        blocked: has("block"),
        reported: has("report"),
        bans: await bansOf(context, actor.id),
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
    if (isOff(context, "notifications")) {
      return c.json(featureOff, 403);
    }
    return c.json({ notifications: await listNotifications(db, context, mediaPublicUrl) }, 200);
  });

  app.openapi(warningsRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "warnings")) {
      return c.json(featureOff, 403);
    }
    return c.json({ warnings: await listWarnings(db, context) }, 200);
  });

  app.openapi(acknowledgeWarningRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "warnings")) {
      return c.json(featureOff, 403);
    }
    const { id } = c.req.valid("param");
    const [warning] = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.id, id),
          eq(schema.notifications.worldId, context.worldId),
          eq(schema.notifications.recipientActorId, context.actorId),
          eq(schema.notifications.type, "warn"),
          lte(schema.notifications.dueAt, new Date()),
        ),
      );
    if (!warning) {
      return c.json(notAvailable, 404);
    }
    // Pressing it twice, as on a slow connection, still counts as the first time.
    if (warning.acknowledgedAt) {
      return c.json({ ok: true as const }, 200);
    }
    const body = c.req.valid("json");
    await db.transaction(async (tx) => {
      const recorded = await recordEvent(tx, {
        ...participantEvent(context, body.occurredAt, body.clientEventId),
        type: "moderation.warning_acknowledged",
        payload: {},
        targetContentId: warning.targetContentId,
      });
      if (recorded) {
        await tx
          .update(schema.notifications)
          .set({ acknowledgedAt: new Date() })
          .where(eq(schema.notifications.id, id));
      }
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(modLogRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "modLog")) {
      return c.json(featureOff, 403);
    }
    const { space } = c.req.valid("query");
    return c.json({ entries: await listModLog(db, context, space) }, 200);
  });

  app.openapi(notificationsViewedRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "notifications")) {
      return c.json(featureOff, 403);
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
      const key = await storeUploadedImage(
        storage,
        context.worldId,
        context.participantId,
        form.picture,
      );
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
    // Only what actually changed, so the event says what someone edited rather than what the form sent.
    const current = (actor?.profile ?? {}) as ProfileFields;
    const changed = (field: "name" | "bio" | "location") => {
      const value = form[field];
      return value !== undefined && value !== (current[field] ?? "") ? { [field]: value } : {};
    };
    const changes = {
      ...changed("name"),
      ...changed("bio"),
      ...changed("location"),
      ...(picture === undefined ? {} : { picture }),
    };
    const newUsername = form.username && form.username !== actor?.username ? form.username : null;

    await db.transaction(async (tx) => {
      const recorded = await recordEvent(tx, {
        ...participantEvent(context, form.occurredAt, form.clientEventId),
        type: "profile.updated",
        payload: {
          fields: [...Object.keys(changes), ...(newUsername ? ["username"] : [])],
        },
      });
      if (recorded) {
        await tx
          .update(schema.actors)
          .set({
            profile: { ...(actor?.profile as ProfileFields), ...changes },
            ...(newUsername ? { username: newUsername } : {}),
          })
          .where(eq(schema.actors.id, context.actorId));
      }
    });
    return c.json({ ok: true as const }, 200);
  });

  return app;
}
