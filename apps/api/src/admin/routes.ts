import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { findResearcherByEmail, hashPassword, verifyPassword } from "@truman3/accounts";
import { type Database, schema } from "@truman3/db";
import { asc, count, eq, inArray } from "drizzle-orm";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { hashSessionToken } from "../participants/session.ts";
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
                versions: z.array(
                  z.object({
                    id: z.string(),
                    version: z.number(),
                    title: z.string(),
                    frozenAt: z.iso.datetime().nullable(),
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

/** The study IDs a researcher's teams own. Every admin route that touches a study starts here. */
export async function studiesForResearcher(db: Database, researcherId: string) {
  return db
    .select({ study: schema.studies, teamName: schema.teams.name })
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
  secureCookies,
  getClientIp,
  allowLoginAttempt,
}: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };

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
    const counts = studyIds.length
      ? await db
          .select({ studyId: schema.participants.studyId, total: count() })
          .from(schema.participants)
          .where(inArray(schema.participants.studyId, studyIds))
          .groupBy(schema.participants.studyId)
      : [];

    return c.json(
      {
        studies: rows.map(({ study, teamName }) => ({
          id: study.id,
          slug: study.slug,
          team: teamName,
          participants: counts.find((item) => item.studyId === study.id)?.total ?? 0,
          versions: versions
            .filter((version) => version.studyId === study.id)
            .sort((a, b) => b.version - a.version)
            .map((version) => ({
              id: version.id,
              version: version.version,
              title: (version.settings as { title?: string }).title ?? study.slug,
              frozenAt: version.frozenAt?.toISOString() ?? null,
            })),
        })),
      },
      200,
    );
  });

  return app;
}
