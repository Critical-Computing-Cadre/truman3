import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { feedResponseSchema } from "@truman3/core";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { participantFromRequest } from "../participants/session.ts";
import { buildFeed } from "./build.ts";

const feedRoute = createRoute({
  method: "get",
  path: "/feed",
  summary: "What the signed-in participant sees right now",
  request: {
    query: z.object({
      /** A number the app picks on each page load, for studies that reshuffle on each visit. */
      visit: z.coerce.number().int().nonnegative().optional(),
    }),
  },
  responses: {
    200: {
      description: "The feed, in order. Showing it is recorded in feed_impressions",
      content: { "application/json": { schema: feedResponseSchema } },
    },
    401: {
      description: "Not signed in",
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
    },
  },
});

export function createFeedRoutes({ db, mediaPublicUrl }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();

  app.openapi(feedRoute, async (c) => {
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json({ error: "Please sign in." }, 401);
    }

    const posts = await buildFeed({ db, mediaPublicUrl }, context, {
      visit: c.req.valid("query").visit,
    });
    return c.json({ posts }, 200);
  });

  return app;
}
