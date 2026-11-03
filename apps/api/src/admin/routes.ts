import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { findResearcherByEmail, hashPassword, verifyPassword } from "@truman3/accounts";
import { feedResponseSchema, hasPlaceholderConsent, platformFor } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { feedSettingsFor } from "@truman3/feed";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { mediaUrl } from "../feed/build.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { hashSessionToken } from "../participants/session.ts";
import { loadVersion, previewFeed, scriptedContent } from "./preview.ts";
import { createResearcherSession, RESEARCHER_COOKIE, researcherFromRequest } from "./session.ts";

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const notSignedIn = errorResponse("Not signed in");

const researcherSchema = z.object({
  name: z.string(),
  email: z.string(),
  teams: z.array(z.object({ name: z.string(), role: z.string() })),
});

const loginRoute = createRoute({
  method: "post",
  path: "/admin/login",
  summary: "Sign in as a researcher",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ email: z.string().min(1), password: z.string().min(1) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Signed in. A session cookie is set",
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
    },
    401: errorResponse("Wrong email or password"),
    429: errorResponse("Too many attempts"),
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/admin/logout",
  summary: "Sign out",
  responses: {
    200: {
      description: "Signed out",
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
    },
  },
});

const meRoute = createRoute({
  method: "get",
  path: "/admin/me",
  summary: "The signed-in researcher",
  responses: {
    200: {
      description: "Who they are, and their teams",
      content: { "application/json": { schema: researcherSchema } },
    },
    401: notSignedIn,
  },
});

const studiesRoute = createRoute({
  method: "get",
  path: "/admin/studies",
  summary: "The studies this researcher's teams have",
  responses: {
    200: {
      description: "Each study and its versions, newest version first",
      content: {
        "application/json": {
          schema: z.object({
            studies: z.array(
              z.object({
                id: z.string(),
                slug: z.string(),
                team: z.string(),
                participants: z.number(),
                liveVersionId: z.string().nullable(),
                /** Where this study's participants go. Built on the server, so builds name no domain. */
                participantUrl: z.string(),
                role: z.string(),
                openDraftId: z.string().nullable(),
                draftTitle: z.string().nullable(),
                versions: z.array(
                  z.object({
                    id: z.string(),
                    version: z.number(),
                    title: z.string(),
                    frozenAt: z.iso.datetime().nullable(),
                    participants: z.number(),
                    conditions: z.array(z.string()),
                  }),
                ),
              }),
            ),
          }),
        },
      },
    },
    401: notSignedIn,
  },
});

const versionParams = z.object({ versionId: z.uuid() });

const previewInfoRoute = createRoute({
  method: "get",
  path: "/admin/versions/{versionId}/preview-info",
  summary: "What's needed to look through a study version",
  request: { params: versionParams },
  responses: {
    200: {
      description: "Its conditions, length, and the timing of its posts",
      content: {
        "application/json": {
          schema: z.object({
            title: z.string(),
            slug: z.string(),
            version: z.number(),
            siteName: z.string(),
            siteLogoUrl: z.string().nullable(),
            lengthMs: z.number(),
            conditions: z.array(
              z.object({
                key: z.string(),
                ranker: z.string(),
                windowHours: z.number().nullable(),
                platformStyle: z.string(),
                commentBox: z.string(),
                layout: z.string(),
                features: z.record(z.string(), z.boolean()),
              }),
            ),
            posts: z.array(z.object({ offsetMs: z.number(), conditions: z.array(z.string()) })),
            placeholderConsent: z.boolean(),
          }),
        },
      },
    },
    401: notSignedIn,
    404: errorResponse("No such version on this researcher's teams"),
  },
});

const previewRoute = createRoute({
  method: "get",
  path: "/admin/versions/{versionId}/preview",
  summary: "What a new participant would see, in a condition, at a point in the study",
  request: {
    params: versionParams,
    query: z.object({
      condition: z.string().min(1),
      elapsedMs: z.coerce.number().int().nonnegative(),
    }),
  },
  responses: {
    200: {
      description: "The feed, as participants see it. Nothing is recorded",
      content: {
        "application/json": {
          schema: feedResponseSchema.extend({
            targeting: z.record(z.string(), z.array(z.string())),
          }),
        },
      },
    },
    401: notSignedIn,
    404: errorResponse("No such version or condition on this researcher's teams"),
  },
});

/** The study IDs a researcher's teams own. Every admin route that touches a study starts here. */
export async function studiesForResearcher(db: Database, researcherId: string) {
  return db
    .select({
      study: schema.studies,
      teamName: schema.teams.name,
      role: schema.teamMemberships.role,
    })
    .from(schema.teamMemberships)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMemberships.teamId))
    .innerJoin(schema.studies, eq(schema.studies.teamId, schema.teams.id))
    .where(eq(schema.teamMemberships.researcherId, researcherId))
    .orderBy(asc(schema.studies.createdAt));
}

/** Compared against when an email has no account, so a login takes the same time either way. */
const NO_ACCOUNT_HASH = hashPassword("no account has this password");

export function createAdminRoutes({
  db,
  mediaPublicUrl,
  secureCookies,
  getClientIp,
  allowLoginAttempt,
  participantAppUrl = "http://localhost:5180",
}: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };
  const notAvailable = { error: "This isn't available." };

  app.openapi(loginRoute, async (c) => {
    const { email, password } = c.req.valid("json");

    if (
      allowLoginAttempt &&
      !allowLoginAttempt(`${getClientIp(c) ?? "unknown"}:${email.toLowerCase()}`)
    ) {
      return c.json({ error: "Too many attempts. Please wait a minute and try again." }, 429);
    }

    const [researcher] = await findResearcherByEmail(db, email);
    const matches = await verifyPassword(
      password,
      researcher?.passwordHash ?? (await NO_ACCOUNT_HASH),
    );
    if (!researcher || !matches) {
      return c.json({ error: "That email or password isn't right." }, 401);
    }

    const session = await createResearcherSession(db, researcher.id);
    setCookie(c, RESEARCHER_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: secureCookies,
      path: "/",
      expires: session.expiresAt,
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(logoutRoute, async (c) => {
    const token = getCookie(c, RESEARCHER_COOKIE);
    if (token) {
      await db
        .delete(schema.researcherSessions)
        .where(eq(schema.researcherSessions.tokenHash, hashSessionToken(token)));
    }
    deleteCookie(c, RESEARCHER_COOKIE, { path: "/" });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(meRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const teams = await db
      .select({ name: schema.teams.name, role: schema.teamMemberships.role })
      .from(schema.teamMemberships)
      .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMemberships.teamId))
      .where(eq(schema.teamMemberships.researcherId, researcher.id));
    return c.json({ name: researcher.name, email: researcher.email, teams }, 200);
  });

  app.openapi(studiesRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }

    const rows = await studiesForResearcher(db, researcher.id);
    const studyIds = rows.map(({ study }) => study.id);
    const versions = studyIds.length
      ? await db
          .select()
          .from(schema.studyVersions)
          .where(inArray(schema.studyVersions.studyId, studyIds))
      : [];
    const drafts = studyIds.length
      ? await db
          .select({
            id: schema.studyDrafts.id,
            studyId: schema.studyDrafts.studyId,
            settings: schema.studyDrafts.settings,
          })
          .from(schema.studyDrafts)
          .where(
            and(inArray(schema.studyDrafts.studyId, studyIds), isNull(schema.studyDrafts.closedAt)),
          )
      : [];
    // Test participants don't count. They can't be assigned twice, so each is one person.
    const counts = studyIds.length
      ? await db
          .select({ versionId: schema.assignments.studyVersionId, total: count() })
          .from(schema.assignments)
          .innerJoin(
            schema.participants,
            eq(schema.participants.id, schema.assignments.participantId),
          )
          .where(
            and(
              inArray(schema.participants.studyId, studyIds),
              eq(schema.participants.isPilot, false),
              isNull(schema.assignments.decisionPoint),
            ),
          )
          .groupBy(schema.assignments.studyVersionId)
      : [];
    const participantsOn = (versionId: string) =>
      counts.find((item) => item.versionId === versionId)?.total ?? 0;

    return c.json(
      {
        studies: rows.map(({ study, teamName, role }) => ({
          id: study.id,
          slug: study.slug,
          team: teamName,
          participants: versions
            .filter((version) => version.studyId === study.id)
            .reduce((sum, version) => sum + participantsOn(version.id), 0),
          liveVersionId: study.liveVersionId,
          participantUrl: participantAppUrl,
          role,
          openDraftId: drafts.find((draft) => draft.studyId === study.id)?.id ?? null,
          draftTitle:
            (
              drafts.find((draft) => draft.studyId === study.id)?.settings as
                | { title?: string }
                | undefined
            )?.title ?? null,
          versions: versions
            .filter((version) => version.studyId === study.id)
            .sort((a, b) => b.version - a.version)
            .map((version) => ({
              id: version.id,
              version: version.version,
              title: (version.settings as { title?: string }).title ?? study.slug,
              frozenAt: version.frozenAt?.toISOString() ?? null,
              participants: participantsOn(version.id),
              conditions: (
                version.settings as { conditions: { arms: { key: string }[] } }
              ).conditions.arms.map(({ key }) => key),
            })),
        })),
      },
      200,
    );
  });

  /** A version, if this researcher's teams have access to it. */
  const versionForResearcher = async (researcherId: string, versionId: string) => {
    const version = await loadVersion(db, versionId);
    if (!version) {
      return null;
    }
    const allowed = await studiesForResearcher(db, researcherId);
    return allowed.some(({ study }) => study.id === version.studyId) ? version : null;
  };

  app.openapi(previewInfoRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const found = await versionForResearcher(researcher.id, c.req.valid("param").versionId);
    if (!found) {
      return c.json(notAvailable, 404);
    }

    const { settings } = found;
    const rows = await scriptedContent(db, found.version.id);

    return c.json(
      {
        title: settings.title,
        placeholderConsent: hasPlaceholderConsent(
          settings,
          found.version.pages as Record<string, string>,
        ),
        slug: found.slug,
        version: found.version.version,
        siteName: settings.site.name,
        siteLogoUrl: settings.site.logo ? mediaUrl(settings.site.logo, mediaPublicUrl) : null,
        lengthMs: settings.length.days * 24 * 3_600_000,
        conditions: settings.conditions.arms.map(({ key }) => {
          const feed = feedSettingsFor(settings, key);
          return {
            key,
            ranker: feed.ranker,
            windowHours: feed.windowHours ?? null,
            ...platformFor(settings, key),
          };
        }),
        posts: rows
          .filter((row) => row.kind === "post")
          .map((row) => ({ offsetMs: row.offsetMs ?? 0, conditions: row.conditions })),
      },
      200,
    );
  });

  app.openapi(previewRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const found = await versionForResearcher(researcher.id, c.req.valid("param").versionId);
    const { condition, elapsedMs } = c.req.valid("query");
    if (!found?.settings.conditions.arms.some(({ key }) => key === condition)) {
      return c.json(notAvailable, 404);
    }

    const preview = await previewFeed(
      db,
      mediaPublicUrl,
      { id: found.version.id, seed: found.version.seed, settings: found.settings },
      condition,
      elapsedMs,
    );
    return c.json(preview, 200);
  });

  return app;
}
