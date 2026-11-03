import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { healthResponseSchema } from "@truman3/core";
import { Hono } from "hono";
import { createActionRoutes } from "./actions/routes.ts";
import { createDraftRoutes } from "./admin/drafts.ts";
import { createLaunchRoutes } from "./admin/launch.ts";
import { createMonitorRoutes } from "./admin/monitor.ts";
import { createPackRoutes } from "./admin/packs.ts";
import { createProlificRoutes } from "./admin/prolific.ts";
import { createAdminRoutes } from "./admin/routes.ts";
import { describeError } from "./errors.ts";
import { createFeedRoutes } from "./feed/routes.ts";
import { createFlowRoutes } from "./flow/routes.ts";
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
  /** Logs errors in full, including what the query was given. Only for local development. */
  logFullErrors?: boolean;
}

/** Builds the API. Dependencies are passed in so tests can run without a database. */
export function createApp({
  pingDatabase,
  logFullErrors = false,
  ...participantDependencies
}: AppDependencies) {
  const app = new OpenAPIHono();

  const logError = (context: string, error: unknown) => {
    console.error(context, logFullErrors ? error : describeError(error));
  };

  app.onError((error, c) => {
    logError(`${c.req.method} request failed:`, error);
    return c.json({ error: "Something went wrong." }, 500);
  });

  app.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

  app.openapi(readinessRoute, async (c) => {
    try {
      await pingDatabase();
      return c.json({ status: "ok" as const }, 200);
    } catch (error) {
      logError("Database readiness check failed:", error);
      return c.json({ status: "unavailable" as const }, 503);
    }
  });

  app.route("/", createParticipantRoutes(participantDependencies));
  app.route("/", createFeedRoutes(participantDependencies));
  app.route("/", createActionRoutes(participantDependencies));
  app.route("/", createFlowRoutes(participantDependencies));
  app.route("/", createAdminRoutes(participantDependencies));
  app.route("/", createDraftRoutes(participantDependencies));
  app.route("/", createPackRoutes(participantDependencies));
  app.route("/", createMonitorRoutes(participantDependencies));
  app.route("/", createLaunchRoutes(participantDependencies));
  app.route("/", createProlificRoutes(participantDependencies));

  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: { title: "Truman 3 API", version: "0.0.0" },
  });

  // Browsers call /api/..., on the same address as the app they're using. Health checks from inside
  // the network, and existing callers, use the bare paths.
  return new Hono().route("/api", app).route("/", app);
}
