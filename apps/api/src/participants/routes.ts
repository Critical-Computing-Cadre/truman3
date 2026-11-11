import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { featureOn } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import type { Writer } from "@truman3/writer";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { unreadMessages } from "../actions/messages.ts";
import { countUnreadNotifications } from "../actions/notifications.ts";
import type { ProlificConfig } from "../admin/prolific.ts";
import { catchUp } from "../director/director.ts";
import { mediaUrl, participantKarma } from "../feed/build.ts";
import { summarizeDevice } from "./device.ts";
import { enterStudy, entrySettings } from "./enter.ts";
import { hashSessionToken, participantFromRequest, realClock, SESSION_COOKIE } from "./session.ts";

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
      description: "They've finished or withdrawn, or the study isn't open to new participants",
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

const pushRoute = createRoute({
  method: "post",
  path: "/me/push",
  summary: "In the app, where to send this participant's push notifications. See ADR 66",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            /** An Expo push token, from the app. */
            token: z.string().regex(/^(Exponent|Expo)PushToken\[[\w-]+\]$/),
            platform: z.enum(["ios", "android"]),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Saved with this session",
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
    },
    401: {
      description: "Not signed in",
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
    },
    403: {
      description: "This study doesn't send push notifications",
      content: { "application/json": { schema: z.object({ error: z.string() }) } },
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
            bannerUrl: z.string().nullable(),
            siteName: z.string(),
            unreadNotifications: z.number(),
            /** Messages from the cast they haven't opened yet, on a platform with messages. */
            unreadMessages: z.number(),
            /** Their points, on a platform with karma. */
            karma: z.number().optional(),
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
  banner?: string;
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
  /** The participant app's public address, shown to researchers as the study link. */
  participantAppUrl?: string;
  /** What writes improvised lines for Christof. Without one, beats use their fallback lines. */
  writer?: Writer | null;
  /**
   * What time it is for participants. The real time, unless a scenario test is fast-forwarding
   * their world. See ADR 56.
   */
  clock?: () => Date;
  /** How to reach Prolific. Leave out and researchers can't connect to it. */
  prolific?: ProlificConfig;
}

export function createParticipantRoutes(dependencies: ParticipantRouteDependencies) {
  const {
    db,
    mediaPublicUrl,
    getClientIp,
    secureCookies,
    allowEntryAttempt,
    writer,
    clock = realClock,
  } = dependencies;
  const app = new OpenAPIHono();

  // The same message for every unknown study, and it doesn't use the word "study" for participants.
  const notFound = { error: "This page isn't available." };

  app.openapi(entryInfoRoute, async (c) => {
    const settings = await entrySettings(db, c.req.valid("param").slug);
    if (!settings) {
      return c.json(notFound, 404);
    }

    const { site, entry } = settings;
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
      now: clock(),
    });
    if (!result) {
      return c.json(notFound, 404);
    }

    if (result.status === "refused") {
      return c.json({ error: "This account is no longer active." }, 403);
    }
    if (result.status === "closed") {
      return c.json({ error: "This isn't available right now." }, 403);
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
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json({ error: "Please sign in." }, 401);
    }
    // Checked often, in the background, for the unread count, so it's where a beat that needs a
    // model gets its words written. A page someone's looking at never waits for one.
    await catchUp(db, context, { writer, mayWrite: true, now: clock() });

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
        bannerUrl: profile.banner ? mediaUrl(profile.banner, mediaPublicUrl) : null,
        siteName: context.settings.site.name,
        ...(featureOn(context.settings, context.conditionKey, "karma")
          ? { karma: await participantKarma(db, context, clock()) }
          : {}),
        unreadNotifications: featureOn(context.settings, context.conditionKey, "notifications")
          ? await countUnreadNotifications(db, context, clock())
          : 0,
        unreadMessages: featureOn(context.settings, context.conditionKey, "messages")
          ? await unreadMessages(db, context, mediaPublicUrl, clock())
          : 0,
      },
      200,
    );
  });

  app.openapi(pushRoute, async (c) => {
    const context = await participantFromRequest(c, db, clock());
    if (!context) {
      return c.json({ error: "Please sign in." }, 401);
    }
    if (!featureOn(context.settings, context.conditionKey, "push")) {
      return c.json({ error: "This study doesn't send push notifications." }, 403);
    }
    const { token, platform } = c.req.valid("json");
    const session = getCookie(c, SESSION_COOKIE) ?? "";
    // Only what comes after this is sent, so they aren't sent everything that happened before.
    await db
      .update(schema.sessions)
      .set({ pushToken: token, pushPlatform: platform, pushSince: clock() })
      .where(eq(schema.sessions.tokenHash, hashSessionToken(session)));
    return c.json({ ok: true as const }, 200);
  });

  return app;
}
