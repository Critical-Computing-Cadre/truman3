import { randomBytes } from "node:crypto";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { schema } from "@truman3/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { hashSessionToken } from "../participants/session.ts";
import { bearerToken, researcherFromRequest, TOKEN_PREFIX } from "./session.ts";

/**
 * Personal access tokens, so an agent such as the MCP server can work in Truman for a researcher,
 * and what a token can't do. Anything that reaches real participants or their data is for a person
 * in the admin app. An agent can recommend it, and the researcher does it. See ADR 64.
 */

/** How long a token lasts unless the researcher says otherwise. */
const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;

/**
 * What a token can't do, by method and path. Launching, stopping, deleting, withdrawing, real data
 * and participants' photos, what participants write in shared worlds, Prolific, approving what the cast says to participants, Christof's
 * controls, and tokens themselves.
 */
const FOR_PEOPLE_ONLY: { methods: string[]; path: RegExp }[] = [
  { methods: ["POST"], path: /^\/admin\/versions\/[^/]+\/launch$/ },
  { methods: ["POST"], path: /^\/admin\/studies\/[^/]+\/stop$/ },
  { methods: ["DELETE"], path: /^\/admin\/studies\/[^/]+$/ },
  { methods: ["POST", "GET"], path: /^\/admin\/studies\/[^/]+\/withdraw$/ },
  { methods: ["GET", "POST"], path: /^\/admin\/studies\/[^/]+\/(export|photos)$/ },
  { methods: ["GET", "POST"], path: /^\/admin\/studies\/[^/]+\/live(\/.*)?$/ },
  { methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], path: /^\/admin\/prolific(\/.*)?$/ },
  {
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    path: /^\/admin\/studies\/[^/]+\/prolific(\/.*)?$/,
  },
  {
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    path: /^\/admin\/studies\/[^/]+\/christof(\/.*)?$/,
  },
  { methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], path: /^\/admin\/tokens(\/.*)?$/ },
  { methods: ["GET", "PATCH"], path: /^\/admin\/operator(\/.*)?$/ },
  { methods: ["GET", "PUT", "DELETE"], path: /^\/admin\/teams\/[^/]+\/ai$/ },
  {
    methods: ["GET", "POST", "PATCH", "DELETE"],
    path: /^\/admin\/teams\/[^/]+\/(members|invites)(\/.*)?$/,
  },
];

/** The admin path of a request, whether or not it came in under /api. */
const adminPath = (path: string) => path.replace(/^\/api(?=\/admin\/)/, "");

/** Refuses what only a person can do, when an agent asks with a token. */
export const agentLimits: MiddlewareHandler = async (c, next) => {
  if (bearerToken(c)) {
    const path = adminPath(c.req.path);
    const refused = FOR_PEOPLE_ONLY.some(
      ({ methods, path: pattern }) => methods.includes(c.req.method) && pattern.test(path),
    );
    if (refused) {
      return c.json(
        {
          error:
            "A researcher does this in the admin app, not an agent. You can recommend it to them.",
        },
        403,
      );
    }
  }
  await next();
};

const tokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
const errorSchema = z.object({ error: z.string() });

const listRoute = createRoute({
  method: "get",
  path: "/admin/tokens",
  summary: "The signed-in researcher's personal access tokens that still work",
  responses: {
    200: {
      description: "Newest first",
      content: { "application/json": { schema: z.object({ tokens: z.array(tokenSchema) }) } },
    },
    401: { description: "Not signed in", content: { "application/json": { schema: errorSchema } } },
  },
});

const createTokenRoute = createRoute({
  method: "post",
  path: "/admin/tokens",
  summary: "Create a personal access token. Its value is shown only in this response",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().trim().min(1).max(100),
            days: z.number().int().min(1).max(MAX_DAYS).default(DEFAULT_DAYS),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Created",
      content: {
        "application/json": { schema: tokenSchema.extend({ token: z.string() }) },
      },
    },
    401: { description: "Not signed in", content: { "application/json": { schema: errorSchema } } },
  },
});

const revokeRoute = createRoute({
  method: "delete",
  path: "/admin/tokens/{tokenId}",
  summary: "Revoke a personal access token. It stops working at once",
  request: { params: z.object({ tokenId: z.uuid() }) },
  responses: {
    200: {
      description: "Revoked",
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
    },
    401: { description: "Not signed in", content: { "application/json": { schema: errorSchema } } },
    404: {
      description: "Not one of theirs",
      content: { "application/json": { schema: errorSchema } },
    },
  },
});

export function createTokenRoutes({ db }: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const signIn = { error: "Please sign in." };

  app.openapi(listRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(signIn, 401);
    }
    const rows = await db
      .select()
      .from(schema.researcherTokens)
      .where(
        and(
          eq(schema.researcherTokens.researcherId, researcher.id),
          isNull(schema.researcherTokens.revokedAt),
        ),
      )
      .orderBy(desc(schema.researcherTokens.createdAt));
    const now = Date.now();
    return c.json(
      {
        tokens: rows
          .filter(({ expiresAt }) => expiresAt.getTime() > now)
          .map((row) => ({
            id: row.id,
            name: row.name,
            createdAt: row.createdAt.toISOString(),
            expiresAt: row.expiresAt.toISOString(),
            lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
          })),
      },
      200,
    );
  });

  app.openapi(createTokenRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(signIn, 401);
    }
    const { name, days } = c.req.valid("json");
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const [row] = await db
      .insert(schema.researcherTokens)
      .values({
        researcherId: researcher.id,
        name,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      })
      .returning();
    if (!row) {
      throw new Error("The token wasn't saved.");
    }
    return c.json(
      {
        id: row.id,
        name: row.name,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        lastUsedAt: null,
        token,
      },
      200,
    );
  });

  app.openapi(revokeRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(signIn, 401);
    }
    const [revoked] = await db
      .update(schema.researcherTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.researcherTokens.id, c.req.valid("param").tokenId),
          eq(schema.researcherTokens.researcherId, researcher.id),
          isNull(schema.researcherTokens.revokedAt),
        ),
      )
      .returning({ id: schema.researcherTokens.id });
    return revoked
      ? c.json({ ok: true as const }, 200)
      : c.json({ error: "That isn't one of your tokens." }, 404);
  });

  return app;
}
