import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  COMMENT_SORTS,
  type CommentSort,
  canJoinSpacesFor,
  canSortCommentsFor,
  canSortFor,
  FEED_SORTS,
  featureOn,
  feedResponseSchema,
  spaceViewSchema,
} from "@truman3/core";
import { type Database, recordEvent, schema } from "@truman3/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { actionMetaSchema } from "../actions/request.ts";
import { participantEvent } from "../actions/routes.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { type ParticipantContext, participantFromRequest } from "../participants/session.ts";
import { buildFeed, loadSpacesFor, mediaUrl } from "./build.ts";

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: z.object({ error: z.string() }) } },
});

const sortSchema = z.enum(FEED_SORTS);

const feedRoute = createRoute({
  method: "get",
  path: "/feed",
  summary: "What the signed-in participant sees right now",
  request: {
    query: z.object({
      /** A number the app picks on each page load, for studies that reshuffle on each visit. */
      visit: z.coerce.number().int().nonnegative().optional(),
      /** Which list of posts: the home feed, one space's page, or one post's own page. */
      surface: z.enum(["home", "space", "post", "saved", "hidden"]).default("home"),
      /** On a space's page, which space, by its key. */
      space: z.string().optional(),
      /** On a post's own page, which post. */
      post: z.uuid().optional(),
    }),
  },
  responses: {
    200: {
      description: "The feed, in order. Showing it is recorded in feed_impressions",
      content: { "application/json": { schema: feedResponseSchema } },
    },
    401: errorResponse("Not signed in"),
    403: errorResponse("That isn't part of this platform in this condition"),
    404: errorResponse("No such space or post for this participant"),
  },
});

const spacesRoute = createRoute({
  method: "get",
  path: "/spaces",
  summary: "The spaces this participant can see, and whether they're in each",
  responses: {
    200: {
      description: "The spaces, in the study's order",
      content: {
        "application/json": { schema: z.object({ spaces: z.array(spaceViewSchema) }) },
      },
    },
    401: errorResponse("Not signed in"),
    403: errorResponse("Spaces are off in this condition"),
  },
});

const okResponse = {
  description: "Recorded",
  content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
};

const membershipRoute = createRoute({
  method: "post",
  path: "/spaces/{key}/membership",
  summary: "Join or leave a space",
  request: {
    params: z.object({ key: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: actionMetaSchema.extend({ joined: z.boolean() }) },
      },
    },
  },
  responses: {
    200: okResponse,
    401: errorResponse("Not signed in"),
    403: errorResponse("This study doesn't let people join or leave spaces"),
    404: errorResponse("No such space for this participant"),
  },
});

const sortRoute = createRoute({
  method: "post",
  path: "/feed/sort",
  summary: "Record that someone chose an order for a feed",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: actionMetaSchema.extend({
            surface: z.enum(["home", "space"]),
            /** Null goes back to the study's own order. */
            sort: sortSchema.nullable(),
          }),
        },
      },
    },
  },
  responses: {
    200: okResponse,
    401: errorResponse("Not signed in"),
    403: errorResponse("This study sets the order itself"),
  },
});

const commentSortRoute = createRoute({
  method: "post",
  path: "/comments/sort",
  summary: "Record that someone chose an order for comments",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: actionMetaSchema.extend({
            /** Null goes back to the study's own order. */
            sort: z.enum(COMMENT_SORTS).nullable(),
          }),
        },
      },
    },
  },
  responses: {
    200: okResponse,
    401: errorResponse("Not signed in"),
    403: errorResponse("This study sets the order itself"),
  },
});

/**
 * The order of comments this person last chose, from what's recorded, the same way as for feeds. It's
 * ignored wherever the study doesn't let them choose.
 */
async function chosenCommentSort(db: Database, context: ParticipantContext) {
  if (!canSortCommentsFor(context.settings, context.conditionKey)) {
    return null;
  }
  const [latest] = await db
    .select({ payload: schema.events.payload })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.worldId, context.worldId),
        eq(schema.events.participantId, context.participantId),
        eq(schema.events.type, "comments.sort_changed"),
      ),
    )
    .orderBy(desc(schema.events.id))
    .limit(1);
  return (latest?.payload as { sort: CommentSort | null } | undefined)?.sort ?? null;
}

/**
 * The order this person last chose for this kind of list, from what's recorded, so what they saw and
 * what the data says can't disagree. It's ignored wherever the study doesn't let them choose, such
 * as after moving to a condition that sets the order itself.
 */
async function chosenSort(db: Database, context: ParticipantContext, surface: "home" | "space") {
  if (!canSortFor(context.settings, context.conditionKey)) {
    return null;
  }
  const [latest] = await db
    .select({ payload: schema.events.payload })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.worldId, context.worldId),
        eq(schema.events.participantId, context.participantId),
        eq(schema.events.type, "feed.sort_changed"),
        sql`${schema.events.payload}->>'surface' = ${surface}`,
      ),
    )
    .orderBy(desc(schema.events.id))
    .limit(1);
  return (latest?.payload as { sort: "new" | "top" | null } | undefined)?.sort ?? null;
}

const pleaseSignIn = { error: "Please sign in." };
const featureOff = { error: "This isn't part of this platform." };
const notAvailable = { error: "This isn't available." };

export function createFeedRoutes({ db, mediaPublicUrl }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();

  app.openapi(feedRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }

    const { visit, surface, space: spaceKey, post } = c.req.valid("query");

    const commentSort = await chosenCommentSort(db, context);
    if (surface === "post") {
      // A shared link goes to a post's own page, so sharing needs that page to exist.
      if (
        !featureOn(context.settings, context.conditionKey, "postPages") &&
        !featureOn(context.settings, context.conditionKey, "sharing")
      ) {
        return c.json(featureOff, 403);
      }
      if (!post) {
        return c.json(notAvailable, 404);
      }
      const posts = await buildFeed({ db, mediaPublicUrl }, context, {
        surface: "post",
        post,
        commentSort: commentSort ?? undefined,
      });
      if (posts.length === 0) {
        return c.json(notAvailable, 404);
      }
      return c.json({ posts, commentSort }, 200);
    }

    if (surface === "saved" || surface === "hidden") {
      const feature = surface === "saved" ? "saving" : "hiding";
      if (!featureOn(context.settings, context.conditionKey, feature)) {
        return c.json(featureOff, 403);
      }
      const posts = await buildFeed({ db, mediaPublicUrl }, context, {
        surface,
        list: surface,
        commentSort: commentSort ?? undefined,
      });
      return c.json({ posts, commentSort }, 200);
    }

    let space: { id: string } | undefined;
    if (surface === "space") {
      if (!featureOn(context.settings, context.conditionKey, "spaces")) {
        return c.json(featureOff, 403);
      }
      const spaces = await loadSpacesFor(db, context);
      space = spaces.find(({ key }) => key === spaceKey);
      if (!space) {
        return c.json(notAvailable, 404);
      }
    }

    const sort = await chosenSort(db, context, surface);
    const posts = await buildFeed({ db, mediaPublicUrl }, context, {
      visit,
      sort: sort ?? undefined,
      commentSort: commentSort ?? undefined,
      space,
      // Home is recorded as "feed", as it always has been, so its data reads the same either way.
      surface: surface === "space" ? "space" : "feed",
    });
    return c.json({ posts, sort, commentSort }, 200);
  });

  app.openapi(spacesRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (!featureOn(context.settings, context.conditionKey, "spaces")) {
      return c.json(featureOff, 403);
    }
    const spaces = await loadSpacesFor(db, context);
    return c.json(
      {
        spaces: spaces.map(
          ({ key, name, description, rules, picture, banner, accent, joined, baseMembers }) => ({
            key,
            name,
            description,
            rules,
            pictureUrl: picture ? mediaUrl(picture, mediaPublicUrl) : null,
            bannerUrl: banner ? mediaUrl(banner, mediaPublicUrl) : null,
            accent,
            // Only this person is in their world, so they're the only one who can add to it.
            memberCount: baseMembers === null ? null : baseMembers + (joined ? 1 : 0),
            joined,
          }),
        ),
      },
      200,
    );
  });

  app.openapi(membershipRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (
      !featureOn(context.settings, context.conditionKey, "spaces") ||
      !canJoinSpacesFor(context.settings, context.conditionKey)
    ) {
      return c.json(featureOff, 403);
    }
    const { key } = c.req.valid("param");
    const space = (await loadSpacesFor(db, context)).find((item) => item.key === key);
    if (!space) {
      return c.json(notAvailable, 404);
    }

    const body = c.req.valid("json");
    await db.transaction(async (tx) => {
      const recorded = await recordEvent(tx, {
        ...participantEvent(context, body.occurredAt, body.clientEventId),
        type: body.joined ? "space.joined" : "space.left",
        payload: { space: key },
      });
      if (!recorded) {
        return;
      }
      await tx
        .insert(schema.spaceMemberships)
        .values({
          worldId: context.worldId,
          actorId: context.actorId,
          spaceId: space.id,
          joined: body.joined,
        })
        .onConflictDoUpdate({
          target: [
            schema.spaceMemberships.worldId,
            schema.spaceMemberships.actorId,
            schema.spaceMemberships.spaceId,
          ],
          set: { joined: body.joined },
        });
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(sortRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (!canSortFor(context.settings, context.conditionKey)) {
      return c.json({ error: "This study sets the order itself." }, 403);
    }
    const body = c.req.valid("json");
    await recordEvent(db, {
      ...participantEvent(context, body.occurredAt, body.clientEventId),
      type: "feed.sort_changed",
      payload: { surface: body.surface, sort: body.sort },
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(commentSortRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json(pleaseSignIn, 401);
    }
    if (!canSortCommentsFor(context.settings, context.conditionKey)) {
      return c.json({ error: "This study sets the order itself." }, 403);
    }
    const body = c.req.valid("json");
    await recordEvent(db, {
      ...participantEvent(context, body.occurredAt, body.clientEventId),
      type: "comments.sort_changed",
      payload: { sort: body.sort },
    });
    return c.json({ ok: true as const }, 200);
  });

  return app;
}
