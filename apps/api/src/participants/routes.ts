import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { type Database, schema } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { countUnreadNotifications } from "../actions/notifications.ts";
import { mediaUrl } from "../feed/build.ts";
import { summarizeDevice } from "./device.ts";
import { enterStudy, latestFrozenVersion } from "./enter.ts";
import { participantFromRequest, SESSION_COOKIE } from "./session.ts";

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
    403: {
      description: "They've finished or withdrawn, and can't enter again",
      content: { "application/json": { schema: errorSchema } },
    },
    404: {
      description: "No such study",
      content: { "application/json": { schema: errorSchema } },
    },
    429: {
      description: "Too many attempts",
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
          schema: z.object({
            username: z.string(),
            name: z.string(),
            bio: z.string(),
            location: z.string(),
            pictureUrl: z.string().nullable(),
            siteName: z.string(),
            unreadNotifications: z.number(),
          }),
        },
      },
    },
    401: {
      description: "Not signed in",
      content: { "application/json": { schema: errorSchema } },
    },
  },
});

interface ProfileFields {
  name?: string;
  bio?: string;
  location?: string;
  picture?: string;
}

export interface ParticipantRouteDependencies {
  db: Database;
  /** Where browsers fetch stored media from. */
  mediaPublicUrl: string;
  /** Only used by studies that turn on storing IP addresses. */
  getClientIp: (c: Context) => string | undefined;
  /** Where participants' uploaded images go. */
  storage: Storage;
  /** Whether cookies require HTTPS. True everywhere except local development. */
  secureCookies: boolean;
  /** Decides whether an address may try entering right now. Leave out for no limit. */
  allowEntryAttempt?: (ipAddress: string) => boolean;
  /** Decides whether a researcher's login can be tried right now. Leave out for no limit. */
  allowLoginAttempt?: (key: string) => boolean;
}

export function createParticipantRoutes(dependencies: ParticipantRouteDependencies) {
  const { db, mediaPublicUrl, getClientIp, secureCookies, allowEntryAttempt } = dependencies;
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
    if (allowEntryAttempt && !allowEntryAttempt(getClientIp(c) ?? "unknown")) {
      return c.json({ error: "Too many attempts. Please wait a minute and try again." }, 429);
    }

    const result = await enterStudy(db, {
      slug: c.req.valid("param").slug,
      externalId: c.req.valid("json").externalId,
      device: summarizeDevice(c.req.header("user-agent")),
      getIpAddress: () => getClientIp(c),
    });
    if (!result) {
      return c.json(notFound, 404);
    }

    if (result.status === "refused") {
      return c.json({ error: "This account is no longer active." }, 403);
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
    const context = await participantFromRequest(c, db);
    if (!context) {
      return c.json({ error: "Please sign in." }, 401);
    }

    const [row] = await db
      .select({ username: schema.actors.username, profile: schema.actors.profile })
      .from(schema.actors)
      .where(eq(schema.actors.id, context.actorId));
    if (!row) {
      return c.json({ error: "Please sign in." }, 401);
    }

    const profile = row.profile as ProfileFields;
    return c.json(
      {
        username: row.username,
        name: profile.name ?? row.username,
        bio: profile.bio ?? "",
        location: profile.location ?? "",
        pictureUrl: profile.picture ? mediaUrl(profile.picture, mediaPublicUrl) : null,
        siteName: context.settings.site.name,
        unreadNotifications: await countUnreadNotifications(db, context),
      },
      200,
    );
  });

  return app;
}
