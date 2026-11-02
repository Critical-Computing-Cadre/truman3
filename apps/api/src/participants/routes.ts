import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { studySettingsSchema } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { summarizeDevice } from "./device.ts";
import { enterStudy, latestFrozenVersion } from "./enter.ts";
import { loadParticipantContext, SESSION_COOKIE } from "./session.ts";

const errorSchema = z.object({ error: z.string() });

const entryInfoSchema = z.object({
  siteName: z.string(),
  logoUrl: z.string().nullable(),
  idLabel: z.string(),
  idParam: z.string(),
});

const entryInfoRoute = createRoute({
  method: "get",
  path: "/studies/{slug}/entry",
  summary: "What a participant needs to see before entering",
  request: { params: z.object({ slug: z.string() }) },
  responses: {
    200: {
      description: "Details for the entry page",
      content: { "application/json": { schema: entryInfoSchema } },
    },
    404: {
      description: "No such study",
      content: { "application/json": { schema: errorSchema } },
    },
  },
});

const enterRoute = createRoute({
  method: "post",
  path: "/studies/{slug}/enter",
  summary: "Enroll or sign back in with a recruitment ID",
  request: {
    params: z.object({ slug: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({ externalId: z.string().trim().min(1).max(200) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Signed in. A session cookie is set",
      content: { "application/json": { schema: z.object({ returning: z.boolean() }) } },
    },
    404: {
      description: "No such study",
      content: { "application/json": { schema: errorSchema } },
    },
  },
});

const meRoute = createRoute({
  method: "get",
  path: "/me",
  summary: "The signed-in participant",
  responses: {
    200: {
      description:
        "What this participant may know about themselves. Never includes their condition",
      content: {
        "application/json": {
          schema: z.object({ username: z.string(), siteName: z.string() }),
        },
      },
    },
    401: {
      description: "Not signed in",
      content: { "application/json": { schema: errorSchema } },
    },
  },
});

export interface ParticipantRouteDependencies {
  db: Database;
  /** Where browsers fetch stored media from. */
  mediaPublicUrl: string;
  /** Only used by studies that turn on storing IP addresses. */
  getClientIp: (c: Context) => string | undefined;
  /** Whether cookies require HTTPS. True everywhere except local development. */
  secureCookies: boolean;
}

/** A stored media key becomes a URL. Hosted media is already a full URL. */
function mediaUrl(key: string, publicUrl: string): string {
  return /^https?:\/\//.test(key) ? key : `${publicUrl}/${key}`;
}

export function createParticipantRoutes(dependencies: ParticipantRouteDependencies) {
  const { db, mediaPublicUrl, getClientIp, secureCookies } = dependencies;
  const app = new OpenAPIHono();

  // The same message for every unknown study, and it doesn't use the word "study" for participants.
  const notFound = { error: "This page isn't available." };

  app.openapi(entryInfoRoute, async (c) => {
    const latest = await latestFrozenVersion(db, c.req.valid("param").slug);
    if (!latest) {
      return c.json(notFound, 404);
    }

    const { site, entry } = latest.settings;
    return c.json(
      {
        siteName: site.name,
        logoUrl: site.logo ? mediaUrl(site.logo, mediaPublicUrl) : null,
        idLabel: entry.idLabel,
        idParam: entry.idParam,
      },
      200,
    );
  });

  app.openapi(enterRoute, async (c) => {
    const result = await enterStudy(db, {
      slug: c.req.valid("param").slug,
      externalId: c.req.valid("json").externalId,
      device: summarizeDevice(c.req.header("user-agent")),
      getIpAddress: () => getClientIp(c),
    });
    if (!result) {
      return c.json(notFound, 404);
    }

    setCookie(c, SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: secureCookies,
      path: "/",
      expires: result.expiresAt,
    });
    return c.json({ returning: result.returning }, 200);
  });

  app.openapi(meRoute, async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const context = token ? await loadParticipantContext(db, token) : null;
    if (!context) {
      return c.json({ error: "Please sign in." }, 401);
    }

    const [row] = await db
      .select({ username: schema.actors.username, settings: schema.studyVersions.settings })
      .from(schema.actors)
      .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.actors.studyVersionId))
      .where(eq(schema.actors.id, context.actorId));
    if (!row) {
      return c.json({ error: "Please sign in." }, 401);
    }

    return c.json(
      { username: row.username, siteName: studySettingsSchema.parse(row.settings).site.name },
      200,
    );
  });

  return app;
}
