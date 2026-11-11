import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { teamLimitsSchema } from "@truman3/core";
import { schema } from "@truman3/db";
import { encryptSecret, parseSecretKey } from "@truman3/recruit";
import { and, eq } from "drizzle-orm";
import { keyHint, teamSpending } from "../ai.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { researcherFromRequest } from "./session.ts";

/** A lab's own Claude key, and what it's spent, on a hosted Truman (ADR 71). */

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});

const aiSchema = z.object({
  /** Whether this Truman lets a lab store its own key: it's hosted, and has a secret key. */
  canStore: z.boolean(),
  /** The end of the stored key, such as "…a1b2", or null if there's none. */
  keyHint: z.string().nullable(),
  /** What the lab may spend on the host's key, or null for no limit. */
  starterBudgetUsd: z.number().nullable(),
  /** Spent on the host's key, in all. */
  hostUsd: z.number(),
  /** Spent on the lab's own key, in all and in the last 30 days. */
  labUsd: z.number(),
  labLast30DaysUsd: z.number(),
});

const params = z.object({ teamId: z.uuid() });

const getRoute = createRoute({
  method: "get",
  path: "/admin/teams/{teamId}/ai",
  summary: "The lab's Claude key, by its last characters, and what it's spent",
  request: { params },
  responses: {
    200: {
      description: "Its key and spending",
      content: { "application/json": { schema: aiSchema } },
    },
    401: errorResponse("Not signed in"),
    404: errorResponse("Not one of this researcher's teams"),
  },
});

const putRoute = createRoute({
  method: "put",
  path: "/admin/teams/{teamId}/ai",
  summary: "Store the lab's own Claude key, encrypted. Its model use is then paid by the lab",
  request: {
    params,
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ key: z.string().trim().min(20).max(500) }) },
      },
    },
  },
  responses: {
    200: { description: "Stored", content: { "application/json": { schema: aiSchema } } },
    400: errorResponse("That doesn't look like a Claude key"),
    401: errorResponse("Not signed in"),
    403: errorResponse("Only the lab's owners can change its key"),
    404: errorResponse("Not one of this researcher's teams"),
    503: errorResponse("This Truman can't store labs' keys"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/admin/teams/{teamId}/ai",
  summary: "Remove the lab's own Claude key",
  request: { params },
  responses: {
    200: { description: "Removed", content: { "application/json": { schema: aiSchema } } },
    401: errorResponse("Not signed in"),
    403: errorResponse("Only the lab's owners can change its key"),
    404: errorResponse("Not one of this researcher's teams"),
  },
});

export function createTeamAiRoutes({
  db,
  hosted = false,
  secretKey,
}: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const key = parseSecretKey(secretKey);
  const canStore = hosted && key !== null;
  const notYours = { error: "This isn't one of your teams." };
  const ownersOnly = { error: "Only your lab's owners can change its Claude key." };

  /** The researcher's role on the team, or null if they're not on it. */
  const roleOn = async (c: Parameters<typeof researcherFromRequest>[0], teamId: string) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return { status: 401 as const };
    }
    const [membership] = await db
      .select({ role: schema.teamMemberships.role })
      .from(schema.teamMemberships)
      .where(
        and(
          eq(schema.teamMemberships.teamId, teamId),
          eq(schema.teamMemberships.researcherId, researcher.id),
        ),
      );
    return membership ? { status: 200 as const, role: membership.role } : { status: 404 as const };
  };

  const summary = async (teamId: string) => {
    const [team] = await db
      .select({ hint: schema.teams.anthropicKeyHint, limits: schema.teams.limits })
      .from(schema.teams)
      .where(eq(schema.teams.id, teamId));
    const spent = await teamSpending(db, teamId);
    return {
      canStore,
      keyHint: team?.hint ?? null,
      starterBudgetUsd: teamLimitsSchema.parse(team?.limits ?? {}).starterBudgetUsd ?? null,
      hostUsd: spent.hostUsd,
      labUsd: spent.labUsd,
      labLast30DaysUsd: spent.labLast30DaysUsd,
    };
  };

  app.openapi(getRoute, async (c) => {
    const { teamId } = c.req.valid("param");
    const access = await roleOn(c, teamId);
    if (access.status === 401) {
      return c.json({ error: "Please sign in." }, 401);
    }
    if (access.status === 404) {
      return c.json(notYours, 404);
    }
    return c.json(await summary(teamId), 200);
  });

  app.openapi(putRoute, async (c) => {
    const { teamId } = c.req.valid("param");
    const access = await roleOn(c, teamId);
    if (access.status === 401) {
      return c.json({ error: "Please sign in." }, 401);
    }
    if (access.status === 404) {
      return c.json(notYours, 404);
    }
    if (access.role !== "owner") {
      return c.json(ownersOnly, 403);
    }
    if (!canStore || !key) {
      return c.json({ error: "This Truman can't store labs' own keys." }, 503);
    }
    const value = c.req.valid("json").key;
    if (!value.startsWith("sk-ant-")) {
      return c.json(
        { error: "That doesn't look like a Claude key. They start with sk-ant-." },
        400,
      );
    }
    await db
      .update(schema.teams)
      .set({ anthropicKeyEncrypted: encryptSecret(value, key), anthropicKeyHint: keyHint(value) })
      .where(eq(schema.teams.id, teamId));
    return c.json(await summary(teamId), 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { teamId } = c.req.valid("param");
    const access = await roleOn(c, teamId);
    if (access.status === 401) {
      return c.json({ error: "Please sign in." }, 401);
    }
    if (access.status === 404) {
      return c.json(notYours, 404);
    }
    if (access.role !== "owner") {
      return c.json(ownersOnly, 403);
    }
    await db
      .update(schema.teams)
      .set({ anthropicKeyEncrypted: null, anthropicKeyHint: null })
      .where(eq(schema.teams.id, teamId));
    return c.json(await summary(teamId), 200);
  });

  return app;
}
