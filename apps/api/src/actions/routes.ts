import { randomUUID } from "node:crypto";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  type Attachment,
  checkNewPost,
  type FeatureKey,
  featureOn,
  feedPostSchema,
  feedWarningSchema,
  highlightSchema,
  MAX_ATTACHMENTS,
  MAX_LINK_LENGTH,
  MAX_PLACE_LENGTH,
  MAX_REPLY_DEPTH,
  MAX_TITLE_LENGTH,
  maxPostLengthFor,
  modLogEntrySchema,
  POST_TAGS,
  type PostTag,
  platformStyleFor,
  pollOptionsProblem,
  safeLink,
  startingFollowersFor,
  storyGroupSchema,
  trendingFor,
} from "@truman3/core";
import { type Database, recordEvent, schema, type Transaction } from "@truman3/db";
import { and, count, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { catchUp, nthOf, onParticipantAct } from "../director/director.ts";
import {
  buildFeed,
  castKarma,
  contentTimeMs,
  hiddenByBan,
  loadBans,
  loadContextNotes,
  loadLabels,
  loadRemovals,
  loadSpacesFor,
  mediaUrl,
  participantKarma,
} from "../feed/build.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import {
  type ParticipantContext,
  participantFromRequest,
  realClock,
} from "../participants/session.ts";
import { MAX_IMAGE_BYTES, storeUploadedImage } from "./images.ts";
import {
  applyAutoRule,
  findAutoRules,
  listModLog,
  listWarnings,
  reactionsAfterRule,
  recordRuleAsked,
  scheduleAppealAnswer,
} from "./moderation.ts";
import {
  listNotifications,
  scheduleFlagAnswer,
  scheduleReactions,
  scheduleReportAnswer,
} from "./notifications.ts";
import { actionMetaSchema } from "./request.ts";
import { findLiveStory, highlightsOf, listStories, storyViewers } from "./stories.ts";

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

/** A post or comment that went up, or a rule asking if they're sure before it does. */
const writtenSchema = z.union([
  z.object({ id: z.uuid() }),
  z.object({ confirm: z.object({ rule: z.string(), message: z.string(), by: z.string() }) }),
]);

const storiesRoute = createRoute({
  method: "get",
  path: "/stories",
  summary: "Stories that are up now, grouped by who posted them",
  responses: {
    200: {
      description: "This person's own first, then those they haven't seen",
      content: { "application/json": { schema: z.object({ stories: z.array(storyGroupSchema) }) } },
    },
    401: notSignedIn,
  },
});

const newStoryRoute = createRoute({
  method: "post",
  path: "/stories",
  summary: "Post a story: one photo, which lasts a day",
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: actionMetaSchema.extend({
            caption: z.string().max(500).default(""),
            image: z.instanceof(File).openapi({ type: "string", format: "binary" }),
            /** Everyone, or only their close friends, on a platform with close friends. */
            audience: z.enum(["everyone", "closeFriends"]).default("everyone"),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Posted",
      content: { "application/json": { schema: z.object({ id: z.uuid() }) } },
    },
    400: errorResponse("The photo can't be used"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
  },
});

const storyViewedRoute = createRoute({
  method: "post",
  path: "/stories/{id}/viewed",
  summary: "Record that someone saw a story, and how it ended",
  request: {
    params: contentParams,
    ...jsonBody(
      actionMetaSchema.extend({
        dwellMs: z
          .number()
          .nonnegative()
          .max(24 * 60 * 60 * 1000),
        ended: z.enum(["next", "previous", "closed", "timer"]),
        /** Where they opened it. A highlight can show a story after it's left the row. */
        from: z.enum(["row", "highlight"]).default("row"),
      }),
    ),
  },
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("No story that's up for this person"),
  },
});

const storyViewersRoute = createRoute({
  method: "get",
  path: "/stories/{id}/viewers",
  summary: "Who has viewed someone's own story, as the study wrote",
  request: { params: contentParams },
  responses: {
    200: {
      description: "In the order they viewed it",
      content: {
        "application/json": {
          schema: z.object({
            viewers: z.array(
              z.object({
                username: z.string(),
                name: z.string(),
                pictureUrl: z.string().nullable(),
              }),
            ),
          }),
        },
      },
    },
    401: notSignedIn,
    404: errorResponse("Not one of this person's stories"),
  },
});

const noteRatingRoute = createRoute({
  method: "post",
  path: "/content/{id}/note-rating",
  summary: "Rate the context note on a post",
  request: {
    params: contentParams,
    ...jsonBody(actionMetaSchema.extend({ value: z.enum(["helpful", "not_helpful"]).nullable() })),
  },
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("No note on anything this participant can see"),
  },
});

const exploreRoute = createRoute({
  method: "get",
  path: "/explore",
  summary: "What's said to be trending, and who's suggested for following",
  responses: {
    200: {
      description: "Whatever this platform has, which may be nothing",
      content: {
        "application/json": {
          schema: z.object({
            trending: z.array(z.object({ tag: z.string(), note: z.string().optional() })),
            suggested: z.array(
              z.object({
                username: z.string(),
                name: z.string(),
                pictureUrl: z.string().nullable(),
                badge: z.string().optional(),
                followerCount: z.number().optional(),
              }),
            ),
          }),
        },
      },
    },
    401: notSignedIn,
  },
});

const repostRoute = createRoute({
  method: "post",
  path: "/content/{id}/repost",
  summary: "Pass a post along, or take that back",
  request: { params: contentParams, ...jsonBody(toggleBodySchema) },
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("Nothing this participant can see"),
  },
});

const confirmAnsweredRoute = createRoute({
  method: "post",
  path: "/moderation/confirm-answered",
  summary: "They chose not to post when a rule asked if they were sure",
  request: jsonBody(actionMetaSchema.extend({ rule: z.string() })),
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
  },
});

const labelShownRoute = createRoute({
  method: "post",
  path: "/content/{id}/label-shown",
  summary: "Record that someone pressed Show on what a moderator's label covered",
  request: {
    params: contentParams,
    ...jsonBody(actionMetaSchema.extend({ label: z.string().min(1) })),
  },
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("Nothing this participant can see that a label covers"),
  },
});

const appealRoute = createRoute({
  method: "post",
  path: "/content/{id}/appeal",
  summary: "Appeal a moderator's removal or label of what they wrote",
  request: {
    params: contentParams,
    ...jsonBody(actionMetaSchema.extend({ text: z.string().trim().min(1).max(2000) })),
  },
  responses: {
    200: okResponse("Recorded"),
    401: notSignedIn,
    403: errorResponse("That feature is off in this condition"),
    404: errorResponse("Nothing of theirs that a moderator removed or labeled"),
    409: errorResponse("They've already appealed this"),
  },
});

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
    ...jsonBody(
      actionMetaSchema.extend({
        body: z.string().trim().min(1).max(5000),
        /** They've answered a rule's "are you sure?" and want to go ahead. */
        confirmedRule: z.string().optional(),
      }),
    ),
  },
  responses: {
    200: {
      description:
        "Recorded, with its ID. Or a rule asks if they're sure, which means it isn't posted yet",
      content: { "application/json": { schema: writtenSchema } },
    },
    400: errorResponse("It's longer than this study allows"),
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

const muteThreadRoute = createRoute({
  method: "post",
  path: "/content/{id}/mute-thread",
  summary: "Stop notifications about a post and everything under it, or start them again",
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
            /** Where it was, on a platform with places. */
            place: z.string().max(MAX_PLACE_LENGTH).optional(),
            /** Someone in the cast they tag, by username. Repeat it for more, on a platform with tagging. */
            tagged: z.union([z.string(), z.array(z.string())]).optional(),
            /** They've answered a rule's "are you sure?" and want to go ahead. */
            confirmedRule: z.string().optional(),
            /** The post this quotes, on a platform with quote posts. */
            quoteOf: z.uuid().optional(),
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
      description:
        "Recorded, with its ID. Or a rule asks if they're sure, which means it isn't posted yet",
      content: { "application/json": { schema: writtenSchema } },
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
  mute: { kind: "mute", active: true, event: "actor.muted" },
  unmute: { kind: "mute", active: false, event: "actor.unmuted" },
  report: { kind: "report", active: true, event: "actor.reported" },
  addCloseFriend: { kind: "closeFriend", active: true, event: "actor.close_friend_added" },
  removeCloseFriend: { kind: "closeFriend", active: false, event: "actor.close_friend_removed" },
} as const;

const RELATION_FEATURES = {
  follow: "following",
  block: "blocking",
  report: "reporting",
  mute: "muting",
  closeFriend: "closeFriends",
} as const;

const featureOff = { error: "This isn't part of this platform." };

/** Hiding a button isn't enough, so the server refuses whatever's off in this person's condition. */
const isOff = (context: ParticipantContext, feature: FeatureKey) =>
  !featureOn(context.settings, context.conditionKey, feature);

/** How many people one post can tag. */
const MAX_TAGGED = 20;

const peopleRoute = createRoute({
  method: "get",
  path: "/people",
  summary: "The cast, for tagging people in a post",
  responses: {
    200: {
      description: "Everyone in the cast, by username",
      content: {
        "application/json": {
          schema: z.object({
            people: z.array(
              z.object({
                username: z.string(),
                name: z.string(),
                pictureUrl: z.string().nullable(),
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

const relationRoute = createRoute({
  method: "post",
  path: "/actors/{username}/relation",
  summary: "Follow, unfollow, block, unblock, or report an actor",
  request: {
    params: z.object({ username: z.string() }),
    ...jsonBody(
      actionMetaSchema.extend({
        action: z.enum([
          "follow",
          "unfollow",
          "block",
          "unblock",
          "report",
          "mute",
          "unmute",
          "addCloseFriend",
          "removeCloseFriend",
        ]),
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
            /** A wide picture across the top, if the study gave them one. */
            bannerUrl: z.string().nullable(),
            isViewer: z.boolean(),
            following: z.boolean(),
            blocked: z.boolean(),
            reported: z.boolean(),
            muted: z.boolean(),
            /** On a platform that shows these. */
            followerCount: z.number().optional(),
            followingCount: z.number().optional(),
            /** A label the study gives them, on a platform with badges. */
            badge: z.string().optional(),
            /** Where a moderator has banned them. */
            bans: z.array(
              z.object({
                by: z.string(),
                reason: z.string().optional(),
                space: z.string().optional(),
              }),
            ),
            /** Whether this participant has them on their close friends list. */
            closeFriend: z.boolean(),
            /** Stories kept on their profile, on a platform with highlights. */
            highlights: z.array(highlightSchema),
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
                type: z.enum([
                  "read",
                  "like",
                  "reply",
                  "remove",
                  "warn",
                  "label",
                  "answer",
                  "ban",
                  "approve",
                  "uphold",
                  "restore",
                  "repost",
                  "follow",
                  "tag",
                ]),
                actors: z.array(
                  z.object({
                    username: z.string(),
                    name: z.string(),
                    pictureUrl: z.string().nullable(),
                  }),
                ),
                targetIsTheirs: z.boolean(),
                targetKind: z.enum(["post", "comment", "story", "person"]),
                targetName: z.string(),
                /** The post this is about, for a link to its own page. */
                postId: z.string().nullable(),
                /** The comment to go to there, if it's about one. */
                commentId: z.string().nullable(),
                targetBody: z.string(),
                targetImageUrl: z.string().nullable(),
                replyBody: z.string().nullable(),
                reason: z.string().nullable(),
                /** For an answer to an appeal, whether it was of a removal or a label. */
                appealOf: z.enum(["removal", "label"]).optional(),
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
            /** The wide picture across the top of their profile, on a layout that shows one. */
            banner: z.instanceof(File).optional().openapi({ type: "string", format: "binary" }),
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
        // Passing something along isn't writing, so scripted reactions to someone's nth post skip it.
        isNull(schema.content.repostOf),
      ),
    );
  return row?.total ?? 0;
}

interface ProfileFields {
  name?: string;
  bio?: string;
  location?: string;
  picture?: string;
  banner?: string;
  karma?: number;
  followers?: number;
  following?: number;
  badge?: string;
}

export function createActionRoutes({
  db,
  storage,
  mediaPublicUrl,
  writer,
  clock = realClock,
}: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();

  const pleaseSignIn = { error: "Please sign in." };
  const notAvailable = { error: "This isn't available." };

  /** Likes and flags work the same way: an event, plus the current state, together. */
  const toggle = (
    kind: "like" | "flag" | "save" | "hide" | "mute_thread",
    onEvent:
      | "content.liked"
      | "content.flagged"
      | "content.saved"
      | "content.hidden"
      | "content.thread_muted",
    offEvent:
      | "content.unliked"
      | "content.unflagged"
      | "content.unsaved"
      | "content.unhidden"
      | "content.thread_unmuted",
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
        if (kind === "like" && body.active) {
          const [liked] = await tx
            .select({ authorActorId: schema.content.authorActorId })
            .from(schema.content)
            .where(eq(schema.content.id, contentId));
          await onParticipantAct(
            tx,
            context,
            {
              action: "like",
              contentId,
              ...(liked ? { targetActorId: liked.authorActorId } : {}),
              nth: await nthOf(tx, context, "content.liked"),
            },
            clock(),
          );
        }
      });
    };
  };
  const applyLike = toggle("like", "content.liked", "content.unliked");
  const applyFlag = toggle("flag", "content.flagged", "content.unflagged");
  const applySave = toggle("save", "content.saved", "content.unsaved");
  const applyHide = toggle("hide", "content.hidden", "content.unhidden");
  const applyThreadMute = toggle("mute_thread", "content.thread_muted", "content.thread_unmuted");

  const wasRemoved = { error: "A moderator removed this." };
  /** Whether a moderator has taken this down, as far as this person is concerned, by now. */
  const isRemoved = async (context: ParticipantContext, id: string) =>
    (await loadRemovals(db, context, clock())).has(id);

  /** What a browser gets when a rule asks someone if they're sure. */
  const askedBy = async ({
    ref,
    message,
    actorId,
  }: {
    ref: string;
    message: string | null;
    actorId: string;
  }) => {
    const [moderator] = await db.select().from(schema.actors).where(eq(schema.actors.id, actorId));
    return {
      rule: ref,
      message: message ?? "",
      by: (moderator?.profile as ProfileFields | undefined)?.name ?? moderator?.username ?? "",
    };
  };

  /**
   * How many follow someone, and how many they follow. Someone in the cast has what the study wrote,
   * plus this person if they follow them. A participant has what's happened to them.
   */
  const followCountsOf = async (
    context: ParticipantContext,
    actorId: string,
    profile: ProfileFields,
    followedByViewer: boolean,
  ) => {
    if (actorId !== context.actorId) {
      return {
        followerCount: (profile.followers ?? 0) + (followedByViewer ? 1 : 0),
        followingCount: profile.following ?? 0,
      };
    }
    const [follows] = await db
      .select({ total: count() })
      .from(schema.actorRelations)
      .where(
        and(
          eq(schema.actorRelations.worldId, context.worldId),
          eq(schema.actorRelations.actorId, context.actorId),
          eq(schema.actorRelations.kind, "follow"),
        ),
      );
    const [followers] = await db
      .select({ total: count() })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.worldId, context.worldId),
          eq(schema.notifications.type, "follow"),
          lte(schema.notifications.dueAt, clock()),
        ),
      );
    return {
      followerCount:
        startingFollowersFor(context.settings, context.conditionKey) + (followers?.total ?? 0),
      followingCount: follows?.total ?? 0,
    };
  };

  /** Where a moderator has banned someone, for their profile. */
  const bansOf = async (context: ParticipantContext, actorId: string) => {
    const mine = (await loadBans(db, context, clock())).filter(
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
    const item = await findVisibleContent(db, context, id, clock());
    return item?.kind === "post" ? item : null;
  };

  app.openapi(saveRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
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

  app.openapi(muteThreadRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "threadMuting")) {
      return c.json(featureOff, 403);
    }
    const { id } = c.req.valid("param");
    if (!(await visiblePost(context, id))) {
      return c.json(notAvailable, 404);
    }
    await applyThreadMute(context, id, c.req.valid("json"));
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(hideRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
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
    const context = await participantFromRequest(c, db, clock());
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
    const context = await participantFromRequest(c, db, clock());
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
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    const { id } = c.req.valid("param");
    const item = await visiblePost(context, id);
    // Only what actually covered it here, so the record can't say more than they saw.
    // A crosspost shows its original, so it's covered by whatever covers that too.
    const original =
      item?.crosspostOf && !isOff(context, "crossposting")
        ? await findVisibleContent(db, context, item.crosspostOf, clock())
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
    const context = await participantFromRequest(c, db, clock());
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
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "crossposting") || isOff(context, "posting") || isOff(context, "spaces")) {
      return c.json(featureOff, 403);
    }
    const now = clock();
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
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "likes")) {
      return c.json(featureOff, 403);
    }
    const { id } = c.req.valid("param");
    if (!(await findVisibleContent(db, context, id, clock()))) {
      return c.json(notAvailable, 404);
    }
    if (await isRemoved(context, id)) {
      return c.json(wasRemoved, 403);
    }
    await applyLike(context, id, c.req.valid("json"));
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(openRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "postPages")) {
      return c.json(featureOff, 403);
    }
    const { id: contentId } = c.req.valid("param");
    if (!(await findVisibleContent(db, context, contentId, clock()))) {
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
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "votes")) {
      return c.json(featureOff, 403);
    }
    const { id: contentId } = c.req.valid("param");
    if (!(await findVisibleContent(db, context, contentId, clock()))) {
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
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "flagging")) {
      return c.json(featureOff, 403);
    }
    const { id } = c.req.valid("param");
    const now = clock();
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
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "comments")) {
      return c.json(featureOff, 403);
    }
    const now = clock();
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

    const limit = maxPostLengthFor(context.settings, context.conditionKey);
    if (limit && body.body.length > limit) {
      return c.json({ error: `That's longer than the ${limit} characters allowed.` }, 400);
    }
    const rules = await findAutoRules(db, context, "comment", body.body);
    if (rules.confirm && rules.confirm.ref !== body.confirmedRule) {
      await recordRuleAsked(db, context, rules.confirm, body.body, now);
      return c.json({ confirm: await askedBy(rules.confirm) }, 200);
    }
    const afterRule = reactionsAfterRule(rules.act, now);

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

        if (!afterRule.skip) {
          await scheduleReactions(tx, context, {
            on: "comment",
            nth,
            contentId,
            // Without threads, a comment is always on a post, and a scripted reply goes on it too.
            replyUnderId: isOff(context, "threads") ? targetId : contentId,
            spaceId: topPost.spaceId,
            now,
            startAt: afterRule.startAt,
          });
        }
        if (rules.confirm && rules.confirm.ref === body.confirmedRule) {
          await recordEvent(tx, {
            ...participantEvent(context, body.occurredAt, randomUUID()),
            type: "moderation.confirm_answered",
            payload: { rule: rules.confirm.ref, choice: "posted" },
            targetContentId: contentId,
          });
        }
        if (rules.act) {
          await applyAutoRule(tx, context, rules.act, contentId, now);
        }
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
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "posting")) {
      return c.json(featureOff, 403);
    }
    const now = clock();
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
    const place = form.place?.trim() ?? "";
    if (place && isOff(context, "places")) {
      return c.json(featureOff, 403);
    }
    const taggedNames = [...new Set([form.tagged ?? []].flat().map((name) => name.trim()))].filter(
      Boolean,
    );
    if (taggedNames.length > 0 && isOff(context, "photoTags")) {
      return c.json(featureOff, 403);
    }
    if (taggedNames.length > MAX_TAGGED) {
      return c.json({ error: `A post can tag up to ${MAX_TAGGED} people.` }, 400);
    }
    const taggedActors = taggedNames.length > 0 ? await castNamed(context, taggedNames) : [];
    if (taggedActors.length < taggedNames.length) {
      return c.json({ error: "Only people on this platform can be tagged." }, 400);
    }

    const limit = maxPostLengthFor(context.settings, context.conditionKey);
    if (limit && text.length > limit) {
      return c.json({ error: `That's longer than the ${limit} characters allowed.` }, 400);
    }
    if (form.quoteOf && isOff(context, "quotes")) {
      return c.json(featureOff, 403);
    }
    let quoted = form.quoteOf ? await visiblePost(context, form.quoteOf) : null;
    if (form.quoteOf && !quoted) {
      return c.json(notAvailable, 404);
    }
    // Quoting what's shown under someone's repost means quoting the post, not the repost.
    while (quoted?.repostOf) {
      quoted = await findVisibleContent(db, context, quoted.repostOf, now);
    }
    if (quoted && (await isRemoved(context, quoted.id))) {
      return c.json(wasRemoved, 403);
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

    const written = [title, text].filter(Boolean).join("\n");
    const rules = await findAutoRules(db, context, "post", written);
    if (rules.confirm && rules.confirm.ref !== form.confirmedRule) {
      await recordRuleAsked(db, context, rules.confirm, written, now);
      return c.json({ confirm: await askedBy(rules.confirm) }, 200);
    }
    const afterRule = reactionsAfterRule(rules.act, now);

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
            ...(quoted ? { quoteOf: quoted.id } : {}),
            ...(title ? { title } : {}),
            ...(link ? { linkUrl: link } : {}),
            ...(place ? { place } : {}),
            taggedActorIds: taggedActors.map(({ id }) => id),
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
          payload: {
            kind: "post",
            ...(taggedActors.length > 0
              ? { tagged: taggedActors.map(({ username }) => username) }
              : {}),
          },
          targetContentId: contentId,
        });
        if (!recorded) {
          throw new RepeatedAction();
        }

        if (!afterRule.skip) {
          await scheduleReactions(tx, context, {
            on: "post",
            nth,
            contentId,
            replyUnderId: contentId,
            spaceId: space?.id ?? null,
            now,
            startAt: afterRule.startAt,
          });
        }
        if (rules.confirm && rules.confirm.ref === form.confirmedRule) {
          await recordEvent(tx, {
            ...participantEvent(context, form.occurredAt, randomUUID()),
            type: "moderation.confirm_answered",
            payload: { rule: rules.confirm.ref, choice: "posted" },
            targetContentId: contentId,
          });
        }
        if (rules.act) {
          await applyAutoRule(tx, context, rules.act, contentId, now);
        }
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

  /** People in the cast with these usernames, leaving out anyone a participant can't tag. */
  const castNamed = (context: ParticipantContext, usernames: string[]) =>
    db
      .select({ id: schema.actors.id, username: schema.actors.username })
      .from(schema.actors)
      .where(
        and(
          eq(schema.actors.studyVersionId, context.studyVersionId),
          isNull(schema.actors.worldId),
          inArray(schema.actors.username, usernames),
        ),
      );

  app.openapi(peopleRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "photoTags")) {
      return c.json(featureOff, 403);
    }
    const cast = await db
      .select()
      .from(schema.actors)
      .where(
        and(
          eq(schema.actors.studyVersionId, context.studyVersionId),
          isNull(schema.actors.worldId),
        ),
      )
      .orderBy(schema.actors.username);
    return c.json(
      {
        people: cast.map((actor) => {
          const profile = actor.profile as ProfileFields;
          return {
            username: actor.username,
            name: profile.name ?? actor.username,
            pictureUrl: profile.picture ? mediaUrl(profile.picture, mediaPublicUrl) : null,
          };
        }),
      },
      200,
    );
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
    const context = await participantFromRequest(c, db, clock());
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
        await scheduleReportAnswer(tx, context, actor.id, clock());
      }

      const row = {
        worldId: context.worldId,
        actorId: context.actorId,
        targetActorId: actor.id,
        kind,
      };
      if (active) {
        await tx.insert(schema.actorRelations).values(row).onConflictDoNothing();
        if (kind === "follow") {
          await onParticipantAct(
            tx,
            context,
            {
              action: "follow",
              targetActorId: actor.id,
              nth: await nthOf(tx, context, "actor.followed"),
            },
            clock(),
          );
        }
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
    const context = await participantFromRequest(c, db, clock());
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
      now: clock(),
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
    const followCounts = isOff(context, "followCounts")
      ? {}
      : await followCountsOf(context, actor.id, profile, has("follow"));
    const karma = isOff(context, "karma")
      ? {}
      : {
          karma:
            actor.id === context.actorId
              ? await participantKarma(db, context, clock())
              : castKarma(
                  context.settings,
                  context.conditionKey,
                  actor.username,
                  profile.karma,
                  clock().getTime() - context.worldStartedAt.getTime(),
                ),
        };
    return c.json(
      {
        ...karma,
        ...followCounts,
        ...(profile.badge && !isOff(context, "badges") ? { badge: profile.badge } : {}),
        username: actor.username,
        name: profile.name ?? actor.username,
        bio: profile.bio ?? "",
        location: profile.location ?? "",
        pictureUrl: profile.picture ? mediaUrl(profile.picture, mediaPublicUrl) : null,
        bannerUrl: profile.banner ? mediaUrl(profile.banner, mediaPublicUrl) : null,
        isViewer: actor.id === context.actorId,
        following: has("follow"),
        blocked: has("block"),
        reported: has("report"),
        muted: has("mute"),
        closeFriend: has("closeFriend"),
        bans: await bansOf(context, actor.id),
        highlights: await highlightsOf(db, context, actor.id, mediaPublicUrl, clock()),
        posts,
      },
      200,
    );
  });

  app.openapi(notificationsRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "notifications")) {
      return c.json(featureOff, 403);
    }
    await catchUp(db, context, { writer, now: clock() });
    return c.json(
      { notifications: await listNotifications(db, context, mediaPublicUrl, clock()) },
      200,
    );
  });

  app.openapi(storiesRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    return c.json({ stories: await listStories(db, context, mediaPublicUrl, clock()) }, 200);
  });

  app.openapi(newStoryRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "stories") || isOff(context, "posting")) {
      return c.json(featureOff, 403);
    }
    const now = clock();
    const form = c.req.valid("form");
    const closeFriends = form.audience === "closeFriends";
    if (closeFriends && isOff(context, "closeFriends")) {
      return c.json(featureOff, 403);
    }
    const repeat = await findRepeat(db, context.worldId, form.clientEventId);
    if (repeat?.contentId) {
      return c.json({ id: repeat.contentId }, 200);
    }
    const key = await storeUploadedImage(
      storage,
      context.worldId,
      context.participantId,
      form.image,
    );
    if (!key) {
      return c.json(
        {
          error: `That photo can't be used. Use a JPEG, PNG, GIF, or WebP under ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
        },
        400,
      );
    }
    const id = await db.transaction(async (tx) => {
      const nth = await countOwnContent(tx, context, "story");
      const [created] = await tx
        .insert(schema.content)
        .values({
          studyVersionId: context.studyVersionId,
          worldId: context.worldId,
          authorActorId: context.actorId,
          kind: "story",
          body: form.caption.trim(),
          attachments: [{ type: "image", key }],
          closeFriends,
          visibleAt: now,
        })
        .returning({ id: schema.content.id });
      const storyId = created?.id as string;
      await recordEvent(tx, {
        ...participantEvent(context, form.occurredAt, form.clientEventId),
        type: "content.created",
        payload: {
          kind: "story",
          ...(isOff(context, "closeFriends") ? {} : { audience: form.audience }),
        },
        targetContentId: storyId,
      });
      await scheduleReactions(tx, context, {
        on: "story",
        nth,
        contentId: storyId,
        replyUnderId: storyId,
        spaceId: null,
        now,
      });
      return storyId;
    });
    return c.json({ id }, 200);
  });

  app.openapi(storyViewedRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "stories")) {
      return c.json(featureOff, 403);
    }
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const fromHighlight = body.from === "highlight";
    if (fromHighlight && isOff(context, "highlights")) {
      return c.json(featureOff, 403);
    }
    if (!(await findLiveStory(db, context, id, clock(), fromHighlight))) {
      return c.json(notAvailable, 404);
    }
    await db.transaction(async (tx) => {
      const recorded = await recordEvent(tx, {
        ...participantEvent(context, body.occurredAt, body.clientEventId),
        type: "story.viewed",
        payload: {
          dwellMs: body.dwellMs,
          ended: body.ended,
          ...(fromHighlight ? { from: "highlight" as const } : {}),
        },
        targetContentId: id,
      });
      if (recorded) {
        await tx
          .insert(schema.contentInteractions)
          .values({
            worldId: context.worldId,
            actorId: context.actorId,
            contentId: id,
            kind: "view",
          })
          .onConflictDoNothing();
      }
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(storyViewersRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    const { id } = c.req.valid("param");
    const story = await findLiveStory(db, context, id, clock());
    if (!story || story.authorActorId !== context.actorId) {
      return c.json(notAvailable, 404);
    }
    const closeFriendsOnly = story.closeFriends && !isOff(context, "closeFriends");
    return c.json(
      {
        viewers: await storyViewers(db, context, id, mediaPublicUrl, clock(), closeFriendsOnly),
      },
      200,
    );
  });

  app.openapi(noteRatingRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "contextNotes")) {
      return c.json(featureOff, 403);
    }
    const now = clock();
    const { id } = c.req.valid("param");
    const note = (await loadContextNotes(db, context, now, new Map())).get(id);
    if (!note || !(await visiblePost(context, id)) || (await isRemoved(context, id))) {
      return c.json(notAvailable, 404);
    }
    const body = c.req.valid("json");
    await db.transaction(async (tx) => {
      const recorded = await recordEvent(tx, {
        ...participantEvent(context, body.occurredAt, body.clientEventId),
        type: "content.note_rated",
        payload: { note: note.ref, value: body.value },
        targetContentId: id,
      });
      if (!recorded) {
        return;
      }
      await tx
        .delete(schema.contentInteractions)
        .where(
          and(
            eq(schema.contentInteractions.worldId, context.worldId),
            eq(schema.contentInteractions.actorId, context.actorId),
            eq(schema.contentInteractions.contentId, id),
            inArray(schema.contentInteractions.kind, ["note_helpful", "note_not_helpful"]),
          ),
        );
      if (body.value) {
        await tx.insert(schema.contentInteractions).values({
          worldId: context.worldId,
          actorId: context.actorId,
          contentId: id,
          kind: body.value === "helpful" ? "note_helpful" : "note_not_helpful",
        });
      }
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(exploreRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    const trending = isOff(context, "trending")
      ? []
      : trendingFor(
          context.settings,
          context.conditionKey,
          clock().getTime() - context.worldStartedAt.getTime(),
        ).map(({ tag, note }) => ({ tag, ...(note ? { note } : {}) }));
    if (isOff(context, "whoToFollow") || isOff(context, "following")) {
      return c.json({ trending, suggested: [] }, 200);
    }
    const cast = await db
      .select()
      .from(schema.actors)
      .where(
        and(
          eq(schema.actors.studyVersionId, context.studyVersionId),
          isNull(schema.actors.worldId),
        ),
      );
    const relations = await db
      .select({
        target: schema.actorRelations.targetActorId,
        kind: schema.actorRelations.kind,
      })
      .from(schema.actorRelations)
      .where(
        and(
          eq(schema.actorRelations.worldId, context.worldId),
          eq(schema.actorRelations.actorId, context.actorId),
        ),
      );
    const already = new Set(relations.map(({ target }) => target));
    const suggested = cast.flatMap((actor) => {
      const profile = actor.profile as ProfileFields & { suggested?: boolean };
      const inCondition =
        actor.conditions.length === 0 || actor.conditions.includes(context.conditionKey);
      if (!profile.suggested || !inCondition || already.has(actor.id)) {
        return [];
      }
      return [
        {
          username: actor.username,
          name: profile.name ?? actor.username,
          pictureUrl: profile.picture ? mediaUrl(profile.picture, mediaPublicUrl) : null,
          ...(profile.badge && !isOff(context, "badges") ? { badge: profile.badge } : {}),
          ...(isOff(context, "followCounts") ? {} : { followerCount: profile.followers ?? 0 }),
        },
      ];
    });
    return c.json({ trending, suggested }, 200);
  });

  app.openapi(repostRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "reposts")) {
      return c.json(featureOff, 403);
    }
    const now = clock();
    const { id } = c.req.valid("param");
    let target = await visiblePost(context, id);
    // It always points at the first post, so someone's own act isn't part of anyone's chain.
    while (target?.repostOf) {
      target = await findVisibleContent(db, context, target.repostOf, now);
    }
    if (!target) {
      return c.json(notAvailable, 404);
    }
    if (await isRemoved(context, target.id)) {
      return c.json(wasRemoved, 403);
    }
    const root = target;
    const body = c.req.valid("json");
    await db.transaction(async (tx) => {
      const recorded = await recordEvent(tx, {
        ...participantEvent(context, body.occurredAt, body.clientEventId),
        type: body.active ? "content.reposted" : "content.unreposted",
        payload: {},
        targetContentId: root.id,
      });
      if (!recorded) {
        return;
      }
      const mine = and(
        eq(schema.content.worldId, context.worldId),
        eq(schema.content.authorActorId, context.actorId),
        eq(schema.content.repostOf, root.id),
      );
      const [already] = await tx.select({ id: schema.content.id }).from(schema.content).where(mine);
      if (body.active && !already) {
        await tx.insert(schema.content).values({
          studyVersionId: context.studyVersionId,
          worldId: context.worldId,
          repostOf: root.id,
          authorActorId: context.actorId,
          kind: "post",
          visibleAt: now,
        });
        await onParticipantAct(
          tx,
          context,
          {
            action: "repost",
            contentId: root.id,
            targetActorId: root.authorActorId,
            nth: await nthOf(tx, context, "content.reposted"),
          },
          now,
        );
      }
      if (!body.active && already) {
        await tx.delete(schema.content).where(mine);
      }
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(confirmAnsweredRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "autoRules")) {
      return c.json(featureOff, 403);
    }
    const body = c.req.valid("json");
    await recordEvent(db, {
      ...participantEvent(context, body.occurredAt, body.clientEventId),
      type: "moderation.confirm_answered",
      payload: { rule: body.rule, choice: "went_back" },
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(labelShownRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "labels")) {
      return c.json(featureOff, 403);
    }
    const now = clock();
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const item = await findVisibleContent(db, context, id, now);
    const covering = (await loadLabels(db, context, now))
      .get(id)
      ?.some(({ text, hides }) => hides && text === body.label);
    if (!item || item.authorActorId === context.actorId || !covering) {
      return c.json(notAvailable, 404);
    }
    await recordEvent(db, {
      ...participantEvent(context, body.occurredAt, body.clientEventId),
      type: "content.label_shown",
      payload: { label: body.label },
      targetContentId: id,
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(appealRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "appeals")) {
      return c.json(featureOff, 403);
    }
    const now = clock();
    const { id } = c.req.valid("param");
    const item = await findVisibleContent(db, context, id, now);
    const removed = await isRemoved(context, id);
    const labeled = !removed && (await loadLabels(db, context, now)).has(id);
    if (!item || item.authorActorId !== context.actorId || (!removed && !labeled)) {
      return c.json(notAvailable, 404);
    }
    const body = c.req.valid("json");
    const already = await db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.worldId, context.worldId),
          eq(schema.events.type, "moderation.appealed"),
          eq(schema.events.targetContentId, id),
        ),
      )
      .limit(1);
    if (already.length > 0) {
      return c.json({ error: "You've already appealed this." }, 409);
    }
    await db.transaction(async (tx) => {
      const recorded = await recordEvent(tx, {
        ...participantEvent(context, body.occurredAt, body.clientEventId),
        type: "moderation.appealed",
        payload: { text: body.text, of: removed ? "removal" : "label" },
        targetContentId: id,
      });
      if (recorded) {
        await scheduleAppealAnswer(tx, context, id, now);
      }
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(warningsRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "warnings")) {
      return c.json(featureOff, 403);
    }
    return c.json({ warnings: await listWarnings(db, context, clock()) }, 200);
  });

  app.openapi(acknowledgeWarningRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
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
          lte(schema.notifications.dueAt, clock()),
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
          .set({ acknowledgedAt: clock() })
          .where(eq(schema.notifications.id, id));
      }
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(modLogRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (isOff(context, "modLog")) {
      return c.json(featureOff, 403);
    }
    const { space } = c.req.valid("query");
    return c.json({ entries: await listModLog(db, context, space, clock()) }, 200);
  });

  app.openapi(notificationsViewedRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
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
          .set({ notificationsViewedAt: clock() })
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
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    const form = c.req.valid("form");

    const stored = async (file: File | undefined) =>
      file
        ? await storeUploadedImage(storage, context.worldId, context.participantId, file)
        : undefined;
    const picture = await stored(form.picture);
    const banner = await stored(form.banner);
    if (picture === null || banner === null) {
      return c.json({ error: "That photo can't be used." }, 400);
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
      ...(banner === undefined ? {} : { banner }),
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
