import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { roleOnStudy } from "@truman3/accounts";
import { schema } from "@truman3/db";
import { launchVersion, stopNewParticipants } from "@truman3/study-import";
import { eq } from "drizzle-orm";
import { setCookie } from "hono/cookie";
import { startPilot } from "../participants/enter.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { hashSessionToken, realClock, SESSION_COOKIE } from "../participants/session.ts";
import { whyNotLaunchable } from "./hosting.ts";
import { researcherFromRequest } from "./session.ts";

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});

const commonErrors = {
  401: errorResponse("Not signed in"),
  403: errorResponse("This researcher can only view"),
  404: errorResponse("No such study or version on this researcher's teams"),
};

const launchRoute = createRoute({
  method: "post",
  path: "/admin/versions/{versionId}/launch",
  summary: "Make this the version new participants get",
  request: { params: z.object({ versionId: z.uuid() }) },
  responses: {
    200: {
      description: "It's live",
      content: { "application/json": { schema: z.object({ version: z.number() }) } },
    },
    ...commonErrors,
    403: errorResponse(
      "This researcher can only view, or their lab can't open studies now: it's waiting for approval, suspended, or at its limit",
    ),
  },
});

const stopRoute = createRoute({
  method: "post",
  path: "/admin/studies/{studyId}/stop",
  summary: "Close the study to new participants. People already in it can still come back",
  request: { params: z.object({ studyId: z.uuid() }) },
  responses: {
    200: {
      description: "It's closed to new participants",
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
    },
    ...commonErrors,
  },
});

const pilotRoute = createRoute({
  method: "post",
  path: "/admin/versions/{versionId}/pilot",
  summary: "Start a test participant in a condition. Their data stays out of exports",
  request: {
    params: z.object({ versionId: z.uuid() }),
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ condition: z.string().min(1) }) } },
    },
  },
  responses: {
    200: {
      description: "A token for the link that signs in as the test participant",
      content: { "application/json": { schema: z.object({ token: z.string() }) } },
    },
    401: errorResponse("Not signed in"),
    404: errorResponse("No such version or condition on this researcher's teams"),
  },
});

const pilotSessionRoute = createRoute({
  method: "post",
  path: "/pilot-session",
  summary: "Sign in as a test participant, from a link a researcher started",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ token: z.string().min(1) }) } },
    },
  },
  responses: {
    200: {
      description: "Signed in",
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
    },
    404: errorResponse("That link doesn't work"),
  },
});

export function createLaunchRoutes({
  db,
  labKeys,
  secureCookies,
  clock = realClock,
}: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };
  const notAvailable = { error: "This isn't available." };
  const viewOnly = { error: "You can view this study, but not change it." };

  const versionStudy = async (versionId: string) => {
    const [version] = await db
      .select({ studyId: schema.studyVersions.studyId })
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.id, versionId));
    return version?.studyId ?? null;
  };

  app.openapi(launchRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { versionId } = c.req.valid("param");
    const studyId = await versionStudy(versionId);
    const role = studyId ? await roleOnStudy(db, researcher.id, studyId) : null;
    if (!studyId || !role) {
      return c.json(notAvailable, 404);
    }
    if (role === "viewer") {
      return c.json(viewOnly, 403);
    }

    const notYet = await whyNotLaunchable(db, studyId);
    if (notYet) {
      return c.json({ error: notYet }, 403);
    }
    // A lab gets its own key when it first opens a study to participants, and not while it's only
    // building and testing (ADR 82). Before the launch, so nobody real is ever in without it.
    const [owner] = await db
      .select({ teamId: schema.studies.teamId })
      .from(schema.studies)
      .where(eq(schema.studies.id, studyId));
    if (labKeys && owner?.teamId) {
      await labKeys.ensure(db, owner.teamId);
    }
    const result = await launchVersion(db, studyId, versionId, researcher.email);
    return result.status === "launched"
      ? c.json({ version: result.version }, 200)
      : c.json(notAvailable, 404);
  });

  app.openapi(stopRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { studyId } = c.req.valid("param");
    const role = await roleOnStudy(db, researcher.id, studyId);
    if (!role) {
      return c.json(notAvailable, 404);
    }
    if (role === "viewer") {
      return c.json(viewOnly, 403);
    }

    await stopNewParticipants(db, studyId, researcher.email);
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(pilotRoute, async (c) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return c.json(pleaseSignIn, 401);
    }
    const { versionId } = c.req.valid("param");
    const studyId = await versionStudy(versionId);
    if (!studyId || !(await roleOnStudy(db, researcher.id, studyId))) {
      return c.json(notAvailable, 404);
    }

    const pilot = await startPilot(db, versionId, c.req.valid("json").condition, clock());
    return pilot ? c.json({ token: pilot.token }, 200) : c.json(notAvailable, 404);
  });

  app.openapi(pilotSessionRoute, async (c) => {
    const { token } = c.req.valid("json");
    const [session] = await db
      .select({
        expiresAt: schema.sessions.expiresAt,
        isPilot: schema.participants.isPilot,
      })
      .from(schema.sessions)
      .innerJoin(schema.participants, eq(schema.participants.id, schema.sessions.participantId))
      .where(eq(schema.sessions.tokenHash, hashSessionToken(token)));

    // Only test participants can sign in from a link, so this can't be used on real ones.
    if (!session?.isPilot) {
      return c.json({ error: "That link doesn't work." }, 404);
    }

    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: secureCookies,
      path: "/",
      expires: session.expiresAt,
    });
    return c.json({ ok: true as const }, 200);
  });

  return app;
}
