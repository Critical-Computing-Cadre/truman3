import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  canJoinSpacesFor,
  canSortFor,
  featureOn,
  feedResponseSchema,
  spaceViewSchema,
} from "@truman3/core";
import { recordEvent, schema } from "@truman3/db";
import { actionMetaSchema } from "../actions/request.ts";
import { participantEvent } from "../actions/routes.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { participantFromRequest } from "../participants/session.ts";
import { buildFeed, loadSpacesFor } from "./build.ts";

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: z.object({ error: z.string() }) } },
});

const sortSchema = z.enum(["new", "top"]);

const feedRoute = createRoute({
  method: "get",
  path: "/feed",
  summary: "What the signed-in participant sees right now",
  request: {
    query: z.object({
      /** A number the app picks on each page load, for studies that reshuffle on each visit. */
      visit: z.coerce.number().int().nonnegative().optional(),
      /** Which list of posts: the home feed, or one space's page. */
      surface: z.enum(["home", "space"]).default("home"),
      /** On a space's page, which space, by its key. */
      space: z.string().optional(),
      /** An order this person chose, where the study allows that. */
      sort: sortSchema.optional(),
    }),
  },
  responses: {
    200: {
      description: "The feed, in order. Showing it is recorded in feed_impressions",
      content: { "application/json": { schema: feedResponseSchema } },
    },
    401: errorResponse("Not signed in"),
    403: errorResponse("That isn't part of this platform in this condition"),
    404: errorResponse("No such space for this participant"),
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

    const { visit, surface, space: spaceKey, sort } = c.req.valid("query");
    if (sort && !canSortFor(context.settings, context.conditionKey)) {
      return c.json({ error: "This study sets the order itself." }, 403);
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

    const posts = await buildFeed({ db, mediaPublicUrl }, context, {
      visit,
      sort,
      space,
      // Home is recorded as "feed", as it always has been, so its data reads the same either way.
      surface: surface === "space" ? "space" : "feed",
    });
    return c.json({ posts }, 200);
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
        spaces: spaces.map(({ key, name, description, rules, joined }) => ({
          key,
          name,
          description,
          rules,
          joined,
        })),
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

  return app;
}
