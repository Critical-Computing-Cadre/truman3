import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { healthResponseSchema } from "@truman3/core";
import { createFeedRoutes } from "./feed/routes.ts";
import {
  createParticipantRoutes,
  type ParticipantRouteDependencies,
} from "./participants/routes.ts";

const readinessResponseSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
});

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  summary: "Whether the API process is up",
  responses: {
    200: {
      description: "The process is up",
      content: { "application/json": { schema: healthResponseSchema } },
    },
  },
});

const readinessRoute = createRoute({
  method: "get",
  path: "/health/ready",
  summary: "Whether the API can reach its database",
  responses: {
    200: {
      description: "The database is reachable",
      content: { "application/json": { schema: readinessResponseSchema } },
    },
    503: {
      description: "The database is not reachable",
      content: { "application/json": { schema: readinessResponseSchema } },
    },
  },
});

export interface AppDependencies extends ParticipantRouteDependencies {
  pingDatabase: () => Promise<void>;
}

/** Builds the API. Dependencies are passed in so tests can run without a database. */
export function createApp({ pingDatabase, ...participantDependencies }: AppDependencies) {
  const app = new OpenAPIHono();

  app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

  app.openapi(readinessRoute, async (c) => {
    try {
      await pingDatabase();
      return c.json({ status: "ok" as const }, 200);
    } catch (error) {
      console.error("Database readiness check failed:", error);
      return c.json({ status: "unavailable" as const }, 503);
    }
  });

  app.route("/", createParticipantRoutes(participantDependencies));
  app.route("/", createFeedRoutes(participantDependencies));

  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: { title: "Truman 3 API", version: "0.0.0" },
  });

  return app;
}
