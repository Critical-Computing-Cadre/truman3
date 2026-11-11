import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { findResearcherByEmail, hashPassword } from "@truman3/accounts";
import {
  HOSTED_STARTING_LIMITS,
  TEAM_STATUSES,
  type TeamLimits,
  type TeamStatus,
  teamApplicationSchema,
  teamLimitsSchema,
} from "@truman3/core";
import { type Database, schema, type Transaction } from "@truman3/db";
import { and, count, countDistinct, eq, gt, isNotNull, isNull, sql, sum } from "drizzle-orm";
import { setCookie } from "hono/cookie";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { createResearcherSession, RESEARCHER_COOKIE, researcherFromRequest } from "./session.ts";

/**
 * A hosted Truman (ADR 70): labs apply, an operator approves them, and each has limits. A Truman
 * that isn't hosted has none of this, though a team's status and limits still apply if set.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Long enough to be hard to guess, short enough to type. */
const MIN_PASSWORD_LENGTH = 12;

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});

/** The team a study belongs to, with its status and limits, or null for a study without a team. */
export async function teamOfStudy(db: Database | Transaction, studyId: string) {
  const [row] = await db
    .select({ id: schema.teams.id, status: schema.teams.status, limits: schema.teams.limits })
    .from(schema.studies)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.studies.teamId))
    .where(eq(schema.studies.id, studyId));
  return row
    ? {
        id: row.id,
        status: row.status as TeamStatus,
        limits: teamLimitsSchema.parse(row.limits),
      }
    : null;
}

/** Why a study can't be launched now, or null if it can. */
export async function whyNotLaunchable(db: Database, studyId: string): Promise<string | null> {
  const team = await teamOfStudy(db, studyId);
  if (!team) {
    return null;
  }
  if (team.status === "pending") {
    return "Your lab is waiting to be approved. Until then you can build, preview, and test studies, but not open them to participants.";
  }
  if (team.status === "suspended") {
    return "Your lab's account is suspended, so its studies can't be opened to participants.";
  }
  const { runningStudies } = team.limits;
  if (runningStudies !== undefined) {
    const [running] = await db
      .select({ n: count() })
      .from(schema.studies)
      .where(
        and(
          eq(schema.studies.teamId, team.id),
          isNotNull(schema.studies.liveVersionId),
          sql`${schema.studies.id} <> ${studyId}`,
        ),
      );
    if ((running?.n ?? 0) >= runningStudies) {
      return `Your lab can have ${runningStudies} studies open at once. Stop one to open this one, or ask for more.`;
    }
  }
  return null;
}

/**
 * Whether a study's team lets someone new in now: it isn't suspended, and hasn't reached its
 * participants for the month. People already in a study can come back either way, unless it's
 * suspended, which stops their sessions too (see loadParticipantContext).
 */
export async function teamTakesNewParticipants(
  db: Database | Transaction,
  studyId: string,
  now: Date,
): Promise<boolean> {
  const team = await teamOfStudy(db, studyId);
  if (!team) {
    return true;
  }
  if (team.status !== "approved") {
    return false;
  }
  const { participantsPerMonth } = team.limits;
  if (participantsPerMonth === undefined) {
    return true;
  }
  const [recent] = await db
    .select({ n: count() })
    .from(schema.participants)
    .innerJoin(schema.studies, eq(schema.studies.id, schema.participants.studyId))
    .where(
      and(
        eq(schema.studies.teamId, team.id),
        eq(schema.participants.isPilot, false),
        gt(schema.participants.enrolledAt, new Date(now.getTime() - 30 * DAY_MS)),
      ),
    );
  return (recent?.n ?? 0) < participantsPerMonth;
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "lab";

async function freeTeamSlug(db: Database, name: string) {
  const base = slugify(name);
  for (let attempt = 0; attempt < 20; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: schema.teams.id })
      .from(schema.teams)
      .where(eq(schema.teams.slug, slug));
    if (!taken) {
      return slug;
    }
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

const hostingRoute = createRoute({
  method: "get",
  path: "/admin/hosting",
  summary: "Whether this is a hosted Truman, where labs apply",
  responses: {
    200: {
      description: "Hosted or not",
      content: { "application/json": { schema: z.object({ hosted: z.boolean() }) } },
    },
  },
});

const applyRoute = createRoute({
  method: "post",
  path: "/admin/apply",
  summary: "Apply for a lab on a hosted Truman",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: teamApplicationSchema.extend({
            lab: z.string().trim().min(1).max(120),
            name: z.string().trim().min(1).max(120),
            email: z.email().max(320),
            password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Applied, and signed in. The lab waits for approval",
      content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
    },
    404: errorResponse("This Truman isn't hosted"),
    409: errorResponse("There's already an account with that email"),
    429: errorResponse("Too many attempts"),
  },
});

const operatorTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(TEAM_STATUSES),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
  application: teamApplicationSchema.nullable(),
  /** Who applied, so an operator can reach them. Researchers, not participants. */
  owners: z.array(z.object({ name: z.string(), email: z.string() })),
  limits: teamLimitsSchema,
  /** Counts only. An operator never sees a study's content or its participants' data. */
  usage: z.object({
    members: z.number(),
    studies: z.number(),
    runningStudies: z.number(),
    participants: z.number(),
    participantsLast30Days: z.number(),
    /** Spent on models, in US dollars: on the host's key, and on the lab's own (ADR 71). */
    hostAiUsd: z.number(),
    labAiUsd: z.number(),
    /** Whether the lab has stored its own Claude key. Never the key itself. */
    hasOwnKey: z.boolean(),
  }),
});

const operatorTeamsRoute = createRoute({
  method: "get",
  path: "/admin/operator/teams",
  summary: "Every team, with its status, limits, and counts, for an operator",
  responses: {
    200: {
      description: "Teams waiting for approval first, then the rest, newest first",
      content: {
        "application/json": { schema: z.object({ teams: z.array(operatorTeamSchema) }) },
      },
    },
    401: errorResponse("Not signed in"),
    403: errorResponse("Not an operator"),
  },
});

const updateTeamRoute = createRoute({
  method: "patch",
  path: "/admin/operator/teams/{teamId}",
  summary: "Approve, suspend, or reinstate a team, or change its limits",
  request: {
    params: z.object({ teamId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            status: z.enum(["approved", "suspended"]).optional(),
            /** Replaces all its limits. A limit left out means none. */
            limits: teamLimitsSchema.optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Changed",
      content: { "application/json": { schema: operatorTeamSchema } },
    },
    401: errorResponse("Not signed in"),
    403: errorResponse("Not an operator"),
    404: errorResponse("No such team"),
  },
});

async function operatorTeams(db: Database, now: Date, onlyTeamId?: string) {
  const teams = await db
    .select()
    .from(schema.teams)
    .where(onlyTeamId ? eq(schema.teams.id, onlyTeamId) : undefined);
  const counted = async <T extends { teamId: string | null; n: number }>(rows: Promise<T[]>) =>
    new Map((await rows).map(({ teamId, n }) => [teamId, n]));
  const members = await counted(
    db
      .select({ teamId: schema.teamMemberships.teamId, n: count() })
      .from(schema.teamMemberships)
      .groupBy(schema.teamMemberships.teamId),
  );
  const studies = await counted(
    db
      .select({ teamId: schema.studies.teamId, n: count() })
      .from(schema.studies)
      .where(isNull(schema.studies.archivedAt))
      .groupBy(schema.studies.teamId),
  );
  const running = await counted(
    db
      .select({ teamId: schema.studies.teamId, n: count() })
      .from(schema.studies)
      .where(isNotNull(schema.studies.liveVersionId))
      .groupBy(schema.studies.teamId),
  );
  const participantCounts = (since?: Date) =>
    counted(
      db
        .select({ teamId: schema.studies.teamId, n: countDistinct(schema.participants.id) })
        .from(schema.participants)
        .innerJoin(schema.studies, eq(schema.studies.id, schema.participants.studyId))
        .where(
          and(
            eq(schema.participants.isPilot, false),
            since ? gt(schema.participants.enrolledAt, since) : undefined,
          ),
        )
        .groupBy(schema.studies.teamId),
    );
  const spending = await db
    .select({
      teamId: schema.aiSpending.teamId,
      paidBy: schema.aiSpending.paidBy,
      total: sum(schema.aiSpending.costUsd),
    })
    .from(schema.aiSpending)
    .groupBy(schema.aiSpending.teamId, schema.aiSpending.paidBy);
  const spent = (teamId: string, paidBy: string) =>
    Number(spending.find((row) => row.teamId === teamId && row.paidBy === paidBy)?.total ?? 0);
  const participants = await participantCounts();
  const recent = await participantCounts(new Date(now.getTime() - 30 * DAY_MS));
  const owners = await db
    .select({
      teamId: schema.teamMemberships.teamId,
      name: schema.researchers.name,
      email: schema.researchers.email,
    })
    .from(schema.teamMemberships)
    .innerJoin(schema.researchers, eq(schema.researchers.id, schema.teamMemberships.researcherId))
    .where(eq(schema.teamMemberships.role, "owner"));

  const order = (status: string) => (status === "pending" ? 0 : status === "suspended" ? 1 : 2);
  return teams
    .sort(
      (a, b) => order(a.status) - order(b.status) || b.createdAt.getTime() - a.createdAt.getTime(),
    )
    .map((team) => ({
      id: team.id,
      name: team.name,
      slug: team.slug,
      status: team.status as TeamStatus,
      createdAt: team.createdAt.toISOString(),
      decidedAt: team.decidedAt?.toISOString() ?? null,
      decidedBy: team.decidedBy,
      application: team.application ? teamApplicationSchema.parse(team.application) : null,
      owners: owners
        .filter(({ teamId }) => teamId === team.id)
        .map(({ name, email }) => ({ name, email })),
      limits: teamLimitsSchema.parse(team.limits),
      usage: {
        members: members.get(team.id) ?? 0,
        studies: studies.get(team.id) ?? 0,
        runningStudies: running.get(team.id) ?? 0,
        participants: participants.get(team.id) ?? 0,
        participantsLast30Days: recent.get(team.id) ?? 0,
        hostAiUsd: spent(team.id, "host"),
        labAiUsd: spent(team.id, "lab"),
        hasOwnKey: team.anthropicKeyEncrypted !== null,
      },
    }));
}

export function createHostingRoutes({
  db,
  hosted = false,
  secureCookies,
  getClientIp,
  allowLoginAttempt,
}: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const pleaseSignIn = { error: "Please sign in." };
  const operatorsOnly = { error: "Only an operator of this Truman can see this." };

  /** The signed-in researcher if they're an operator, signed in themselves rather than by a token. */
  const operatorFor = async (c: Parameters<typeof researcherFromRequest>[0]) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return { status: 401 as const };
    }
    const [row] = await db
      .select({ operator: schema.researchers.operator })
      .from(schema.researchers)
      .where(eq(schema.researchers.id, researcher.id));
    return row?.operator && !researcher.token
      ? { status: 200 as const, researcher }
      : { status: 403 as const };
  };

  app.openapi(hostingRoute, (c) => c.json({ hosted }, 200));

  app.openapi(applyRoute, async (c) => {
    if (!hosted) {
      return c.json({ error: "This Truman doesn't take applications." }, 404);
    }
    const { lab, name, email, password, institution, purpose, website } = c.req.valid("json");
    if (allowLoginAttempt && !allowLoginAttempt(`apply:${getClientIp(c) ?? "unknown"}`)) {
      return c.json({ error: "Too many attempts. Please wait a minute and try again." }, 429);
    }
    const [existing] = await findResearcherByEmail(db, email);
    if (existing) {
      return c.json(
        {
          error:
            "There's already an account with that email. Sign in instead, or ask your lab's owner to add you.",
        },
        409,
      );
    }
    const slug = await freeTeamSlug(db, lab);
    const passwordHash = await hashPassword(password);
    const researcherId = await db.transaction(async (tx) => {
      const [team] = await tx
        .insert(schema.teams)
        .values({
          name: lab,
          slug,
          status: "pending",
          application: { institution, purpose, ...(website ? { website } : {}) },
        })
        .returning({ id: schema.teams.id });
      const [researcher] = await tx
        .insert(schema.researchers)
        .values({ email: email.trim().toLowerCase(), name, passwordHash })
        .returning({ id: schema.researchers.id });
      await tx.insert(schema.teamMemberships).values({
        teamId: team?.id as string,
        researcherId: researcher?.id as string,
        role: "owner",
      });
      return researcher?.id as string;
    });

    const session = await createResearcherSession(db, researcherId);
    setCookie(c, RESEARCHER_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: secureCookies,
      path: "/",
      expires: session.expiresAt,
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(operatorTeamsRoute, async (c) => {
    const operator = await operatorFor(c);
    if (operator.status === 401) {
      return c.json(pleaseSignIn, 401);
    }
    if (operator.status === 403) {
      return c.json(operatorsOnly, 403);
    }
    return c.json({ teams: await operatorTeams(db, new Date()) }, 200);
  });

  app.openapi(updateTeamRoute, async (c) => {
    const operator = await operatorFor(c);
    if (operator.status === 401) {
      return c.json(pleaseSignIn, 401);
    }
    if (operator.status === 403) {
      return c.json(operatorsOnly, 403);
    }
    const { teamId } = c.req.valid("param");
    const { status, limits } = c.req.valid("json");
    const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, teamId));
    if (!team) {
      return c.json({ error: "There's no such team." }, 404);
    }
    const changes: Partial<typeof schema.teams.$inferInsert> = {};
    if (status && status !== team.status) {
      changes.status = status;
      changes.decidedAt = new Date();
      changes.decidedBy = operator.researcher.email;
      // A lab approved for the first time starts with a hosted Truman's usual limits.
      if (status === "approved" && team.status === "pending" && !limits) {
        changes.limits = {
          ...HOSTED_STARTING_LIMITS,
          ...teamLimitsSchema.parse(team.limits),
        } satisfies TeamLimits;
      }
    }
    if (limits) {
      changes.limits = limits;
    }
    if (Object.keys(changes).length > 0) {
      await db.update(schema.teams).set(changes).where(eq(schema.teams.id, teamId));
    }
    const [updated] = await operatorTeams(db, new Date(), teamId);
    return c.json(updated as z.infer<typeof operatorTeamSchema>, 200);
  });

  return app;
}
