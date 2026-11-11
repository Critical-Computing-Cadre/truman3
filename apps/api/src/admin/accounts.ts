import { randomBytes } from "node:crypto";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { findResearcherByEmail, hashPassword } from "@truman3/accounts";
import { type Database, schema } from "@truman3/db";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { type Mailer, sendQuietly } from "../mail.ts";
import type { ParticipantRouteDependencies } from "../participants/routes.ts";
import { hashSessionToken } from "../participants/session.ts";
import { createResearcherSession, RESEARCHER_COOKIE, researcherFromRequest } from "./session.ts";

/**
 * Accounts by email (ADR 72): resetting a forgotten password, inviting someone to a team, and a
 * team's owners managing who's on it.
 */

const RESET_HOURS = 1;
const INVITE_DAYS = 7;
const MIN_PASSWORD_LENGTH = 12;
const ROLES = ["owner", "editor", "viewer"] as const;
type Role = (typeof ROLES)[number];

const errorSchema = z.object({ error: z.string() });
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorSchema } },
});
const ok = {
  description: "Done",
  content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
};
const password = z.string().min(MIN_PASSWORD_LENGTH).max(200);
const normalize = (email: string) => email.trim().toLowerCase();

/** A new link's token, and its hash, which is all that's kept. */
function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

/** A link that hasn't been used or run out, by its token. */
async function liveLink(db: Database, token: string, kind: "reset" | "invite") {
  const [link] = await db
    .select()
    .from(schema.researcherLinks)
    .where(
      and(
        eq(schema.researcherLinks.tokenHash, hashSessionToken(token)),
        eq(schema.researcherLinks.kind, kind),
        isNull(schema.researcherLinks.usedAt),
        gt(schema.researcherLinks.expiresAt, new Date()),
      ),
    );
  return link ?? null;
}

/** Marks a link used, unless something else just did. True if this did. */
async function useLink(db: Database, id: string) {
  const [used] = await db
    .update(schema.researcherLinks)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.researcherLinks.id, id), isNull(schema.researcherLinks.usedAt)))
    .returning({ id: schema.researcherLinks.id });
  return Boolean(used);
}

function signIn(c: Context, secureCookies: boolean, session: { token: string; expiresAt: Date }) {
  setCookie(c, RESEARCHER_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: secureCookies,
    path: "/",
    expires: session.expiresAt,
  });
}

const resetRoute = createRoute({
  method: "post",
  path: "/admin/password-reset",
  summary: "Email a link to reset a forgotten password",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ email: z.email().max(320) }) } },
    },
  },
  responses: {
    200: { ...ok, description: "Sent if there's an account. The answer is the same either way" },
    429: errorResponse("Too many attempts"),
  },
});

const completeResetRoute = createRoute({
  method: "post",
  path: "/admin/password-reset/complete",
  summary: "Set a new password with the link's token, and sign in",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ token: z.string().min(1).max(200), password }) },
      },
    },
  },
  responses: {
    200: ok,
    400: errorResponse("The link has been used or has run out"),
  },
});

const teamParams = z.object({ teamId: z.uuid() });

const membersRoute = createRoute({
  method: "get",
  path: "/admin/teams/{teamId}/members",
  summary: "Who's on a team, and who's been invited",
  request: { params: teamParams },
  responses: {
    200: {
      description: "Its members and open invitations",
      content: {
        "application/json": {
          schema: z.object({
            members: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                email: z.string(),
                role: z.enum(ROLES),
              }),
            ),
            invites: z.array(
              z.object({
                id: z.string(),
                email: z.string(),
                role: z.enum(ROLES),
                expiresAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
    401: errorResponse("Not signed in"),
    404: errorResponse("Not one of this researcher's teams"),
  },
});

const inviteRoute = createRoute({
  method: "post",
  path: "/admin/teams/{teamId}/invites",
  summary: "Invite someone to the team by email",
  request: {
    params: teamParams,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ email: z.email().max(320), role: z.enum(ROLES) }),
        },
      },
    },
  },
  responses: {
    200: ok,
    401: errorResponse("Not signed in"),
    403: errorResponse("Only owners can invite"),
    404: errorResponse("Not one of this researcher's teams"),
    409: errorResponse("They're already on the team"),
  },
});

const revokeInviteRoute = createRoute({
  method: "delete",
  path: "/admin/teams/{teamId}/invites/{inviteId}",
  summary: "Cancel an invitation",
  request: { params: teamParams.extend({ inviteId: z.uuid() }) },
  responses: {
    200: ok,
    401: errorResponse("Not signed in"),
    403: errorResponse("Only owners can cancel invitations"),
    404: errorResponse("No such invitation on this team"),
  },
});

const memberParams = teamParams.extend({ researcherId: z.uuid() });

const changeRoleRoute = createRoute({
  method: "patch",
  path: "/admin/teams/{teamId}/members/{researcherId}",
  summary: "Change a member's role",
  request: {
    params: memberParams,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ role: z.enum(ROLES) }) } },
    },
  },
  responses: {
    200: ok,
    401: errorResponse("Not signed in"),
    403: errorResponse("Only owners can change roles"),
    404: errorResponse("No such member"),
    409: errorResponse("A team needs an owner"),
  },
});

const removeMemberRoute = createRoute({
  method: "delete",
  path: "/admin/teams/{teamId}/members/{researcherId}",
  summary: "Take someone off the team, or leave it",
  request: { params: memberParams },
  responses: {
    200: ok,
    401: errorResponse("Not signed in"),
    403: errorResponse("Only owners can take others off"),
    404: errorResponse("No such member"),
    409: errorResponse("A team needs an owner"),
  },
});

const invitationRoute = createRoute({
  method: "get",
  path: "/admin/invites/{token}",
  summary: "What an invitation is for, before accepting it",
  request: { params: z.object({ token: z.string().min(1).max(200) }) },
  responses: {
    200: {
      description: "The invitation",
      content: {
        "application/json": {
          schema: z.object({
            team: z.string(),
            role: z.enum(ROLES),
            email: z.string(),
            /** Whether that email has an account, so they sign in rather than make one. */
            hasAccount: z.boolean(),
            invitedBy: z.string().nullable(),
          }),
        },
      },
    },
    404: errorResponse("The link has been used or has run out"),
  },
});

const acceptRoute = createRoute({
  method: "post",
  path: "/admin/invites/{token}/accept",
  summary: "Join the team: signed in as the invited email, or making an account for it",
  request: {
    params: z.object({ token: z.string().min(1).max(200) }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().trim().min(1).max(120).optional(),
            password: password.optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: ok,
    400: errorResponse("A new account needs a name and a password"),
    401: errorResponse("That email has an account, so sign in first"),
    403: errorResponse("Signed in as someone else"),
    404: errorResponse("The link has been used or has run out"),
  },
});

/** Owners are told something was done with their team, but not why it failed. */
async function ownerCount(db: Database, teamId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(schema.teamMemberships)
    .where(
      and(eq(schema.teamMemberships.teamId, teamId), eq(schema.teamMemberships.role, "owner")),
    );
  return row?.n ?? 0;
}

export function createAccountRoutes({
  db,
  mailer,
  adminAppUrl = "http://localhost:5181/admin/",
  secureCookies,
  getClientIp,
  allowLoginAttempt,
}: ParticipantRouteDependencies) {
  const app = new OpenAPIHono();
  const link = (path: string, token: string) =>
    `${adminAppUrl.replace(/\/?$/, "/")}${path}?token=${token}`;
  const pleaseSignIn = { error: "Please sign in." };
  const notYours = { error: "This isn't one of your teams." };
  const ownersOnly = { error: "Only your team's owners can do that." };
  const gone = { error: "This link has been used, or has run out. Ask for a new one." };
  const needsOwner = { error: "A team needs at least one owner." };

  /** The researcher and their role on the team, if they're on it. */
  const onTeam = async (c: Context, teamId: string) => {
    const researcher = await researcherFromRequest(c, db);
    if (!researcher) {
      return { status: 401 as const };
    }
    const [membership] = await db
      .select({ role: schema.teamMemberships.role, team: schema.teams.name })
      .from(schema.teamMemberships)
      .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMemberships.teamId))
      .where(
        and(
          eq(schema.teamMemberships.teamId, teamId),
          eq(schema.teamMemberships.researcherId, researcher.id),
        ),
      );
    return membership
      ? {
          status: 200 as const,
          researcher,
          role: membership.role as Role,
          team: membership.team,
          // People only. An agent's token doesn't manage who's on a team.
          isOwner: membership.role === "owner" && !researcher.token,
        }
      : { status: 404 as const };
  };

  app.openapi(resetRoute, async (c) => {
    const email = normalize(c.req.valid("json").email);
    if (allowLoginAttempt && !allowLoginAttempt(`reset:${getClientIp(c) ?? "unknown"}`)) {
      return c.json({ error: "Too many attempts. Please wait a minute and try again." }, 429);
    }
    const [researcher] = await findResearcherByEmail(db, email);
    if (researcher) {
      const { token, tokenHash } = newToken();
      await db.insert(schema.researcherLinks).values({
        kind: "reset",
        tokenHash,
        email,
        researcherId: researcher.id,
        expiresAt: new Date(Date.now() + RESET_HOURS * 60 * 60 * 1000),
      });
      await sendQuietly(mailer, {
        to: email,
        subject: "Reset your Truman password",
        text: `Someone asked to reset the password for your Truman account. If it was you, choose a new one here, within an hour:

${link("reset", token)}

If it wasn't you, you can ignore this email. Your password hasn't changed.`,
      });
    }
    // The same either way, so this can't be used to find out who has an account.
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(completeResetRoute, async (c) => {
    const { token, password: chosen } = c.req.valid("json");
    const found = await liveLink(db, token, "reset");
    if (!found?.researcherId || !(await useLink(db, found.id))) {
      return c.json(gone, 400);
    }
    await db
      .update(schema.researchers)
      .set({ passwordHash: await hashPassword(chosen) })
      .where(eq(schema.researchers.id, found.researcherId));
    // Signed out everywhere else, in case someone else had their password.
    await db
      .delete(schema.researcherSessions)
      .where(eq(schema.researcherSessions.researcherId, found.researcherId));
    signIn(c, secureCookies, await createResearcherSession(db, found.researcherId));
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(membersRoute, async (c) => {
    const { teamId } = c.req.valid("param");
    const access = await onTeam(c, teamId);
    if (access.status === 401) {
      return c.json(pleaseSignIn, 401);
    }
    if (access.status === 404) {
      return c.json(notYours, 404);
    }
    const members = await db
      .select({
        id: schema.researchers.id,
        name: schema.researchers.name,
        email: schema.researchers.email,
        role: schema.teamMemberships.role,
      })
      .from(schema.teamMemberships)
      .innerJoin(schema.researchers, eq(schema.researchers.id, schema.teamMemberships.researcherId))
      .where(eq(schema.teamMemberships.teamId, teamId));
    const invites = await db
      .select()
      .from(schema.researcherLinks)
      .where(
        and(
          eq(schema.researcherLinks.teamId, teamId),
          eq(schema.researcherLinks.kind, "invite"),
          isNull(schema.researcherLinks.usedAt),
          gt(schema.researcherLinks.expiresAt, new Date()),
        ),
      );
    return c.json(
      {
        members: members.map((member) => ({ ...member, role: member.role as Role })),
        invites: invites.map((invite) => ({
          id: invite.id,
          email: invite.email,
          role: invite.role as Role,
          expiresAt: invite.expiresAt.toISOString(),
        })),
      },
      200,
    );
  });

  app.openapi(inviteRoute, async (c) => {
    const { teamId } = c.req.valid("param");
    const access = await onTeam(c, teamId);
    if (access.status === 401) {
      return c.json(pleaseSignIn, 401);
    }
    if (access.status === 404) {
      return c.json(notYours, 404);
    }
    if (!access.isOwner) {
      return c.json(ownersOnly, 403);
    }
    const { role } = c.req.valid("json");
    const email = normalize(c.req.valid("json").email);
    const [already] = await db
      .select({ id: schema.researchers.id })
      .from(schema.teamMemberships)
      .innerJoin(schema.researchers, eq(schema.researchers.id, schema.teamMemberships.researcherId))
      .where(and(eq(schema.teamMemberships.teamId, teamId), eq(schema.researchers.email, email)));
    if (already) {
      return c.json({ error: "They're already on this team." }, 409);
    }
    const { token, tokenHash } = newToken();
    await db.insert(schema.researcherLinks).values({
      kind: "invite",
      tokenHash,
      email,
      teamId,
      role,
      createdBy: access.researcher.id,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
    });
    await sendQuietly(mailer, {
      to: email,
      subject: `${access.researcher.name} invited you to ${access.team} on Truman`,
      text: `${access.researcher.name} invited you to join ${access.team} on Truman, as ${role === "owner" ? "an owner" : `an ${role}`}. Truman is a platform for social media research.

Accept here, within ${INVITE_DAYS} days:

${link("invite", token)}

If you weren't expecting this, you can ignore it.`,
    });
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(revokeInviteRoute, async (c) => {
    const { teamId, inviteId } = c.req.valid("param");
    const access = await onTeam(c, teamId);
    if (access.status === 401) {
      return c.json(pleaseSignIn, 401);
    }
    if (access.status === 404) {
      return c.json(notYours, 404);
    }
    if (!access.isOwner) {
      return c.json(ownersOnly, 403);
    }
    const [revoked] = await db
      .update(schema.researcherLinks)
      .set({ expiresAt: new Date() })
      .where(
        and(
          eq(schema.researcherLinks.id, inviteId),
          eq(schema.researcherLinks.teamId, teamId),
          eq(schema.researcherLinks.kind, "invite"),
        ),
      )
      .returning({ id: schema.researcherLinks.id });
    return revoked
      ? c.json({ ok: true as const }, 200)
      : c.json({ error: "There's no such invitation." }, 404);
  });

  app.openapi(changeRoleRoute, async (c) => {
    const { teamId, researcherId } = c.req.valid("param");
    const { role } = c.req.valid("json");
    const access = await onTeam(c, teamId);
    if (access.status === 401) {
      return c.json(pleaseSignIn, 401);
    }
    if (access.status === 404) {
      return c.json(notYours, 404);
    }
    if (!access.isOwner) {
      return c.json(ownersOnly, 403);
    }
    const [member] = await db
      .select({ role: schema.teamMemberships.role })
      .from(schema.teamMemberships)
      .where(
        and(
          eq(schema.teamMemberships.teamId, teamId),
          eq(schema.teamMemberships.researcherId, researcherId),
        ),
      );
    if (!member) {
      return c.json({ error: "They aren't on this team." }, 404);
    }
    if (member.role === "owner" && role !== "owner" && (await ownerCount(db, teamId)) <= 1) {
      return c.json(needsOwner, 409);
    }
    await db
      .update(schema.teamMemberships)
      .set({ role })
      .where(
        and(
          eq(schema.teamMemberships.teamId, teamId),
          eq(schema.teamMemberships.researcherId, researcherId),
        ),
      );
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(removeMemberRoute, async (c) => {
    const { teamId, researcherId } = c.req.valid("param");
    const access = await onTeam(c, teamId);
    if (access.status === 401) {
      return c.json(pleaseSignIn, 401);
    }
    if (access.status === 404) {
      return c.json(notYours, 404);
    }
    const leaving = researcherId === access.researcher.id && !access.researcher.token;
    if (!access.isOwner && !leaving) {
      return c.json(ownersOnly, 403);
    }
    const [member] = await db
      .select({ role: schema.teamMemberships.role })
      .from(schema.teamMemberships)
      .where(
        and(
          eq(schema.teamMemberships.teamId, teamId),
          eq(schema.teamMemberships.researcherId, researcherId),
        ),
      );
    if (!member) {
      return c.json({ error: "They aren't on this team." }, 404);
    }
    if (member.role === "owner" && (await ownerCount(db, teamId)) <= 1) {
      return c.json(needsOwner, 409);
    }
    await db
      .delete(schema.teamMemberships)
      .where(
        and(
          eq(schema.teamMemberships.teamId, teamId),
          eq(schema.teamMemberships.researcherId, researcherId),
        ),
      );
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(invitationRoute, async (c) => {
    const found = await liveLink(db, c.req.valid("param").token, "invite");
    if (!found?.teamId) {
      return c.json(gone, 404);
    }
    const [team] = await db
      .select({ name: schema.teams.name })
      .from(schema.teams)
      .where(eq(schema.teams.id, found.teamId));
    const [inviter] = found.createdBy
      ? await db
          .select({ name: schema.researchers.name })
          .from(schema.researchers)
          .where(eq(schema.researchers.id, found.createdBy))
      : [];
    const [account] = await findResearcherByEmail(db, found.email);
    return c.json(
      {
        team: team?.name ?? "",
        role: found.role as Role,
        email: found.email,
        hasAccount: Boolean(account),
        invitedBy: inviter?.name ?? null,
      },
      200,
    );
  });

  app.openapi(acceptRoute, async (c) => {
    const found = await liveLink(db, c.req.valid("param").token, "invite");
    if (!found?.teamId || !found.role) {
      return c.json(gone, 404);
    }
    const [account] = await findResearcherByEmail(db, found.email);
    let researcherId: string;
    if (account) {
      // The account is theirs, so they show it by signing in.
      const researcher = await researcherFromRequest(c, db);
      if (!researcher) {
        return c.json({ error: `Sign in as ${found.email} to accept.` }, 401);
      }
      if (researcher.id !== account.id || researcher.token) {
        return c.json(
          { error: `This invitation is for ${found.email}. Sign in as them to accept it.` },
          403,
        );
      }
      researcherId = account.id;
    } else {
      const { name, password: chosen } = c.req.valid("json");
      if (!name || !chosen) {
        return c.json({ error: "Choose your name and a password to make your account." }, 400);
      }
      const [made] = await db
        .insert(schema.researchers)
        .values({ email: found.email, name, passwordHash: await hashPassword(chosen) })
        .onConflictDoNothing()
        .returning({ id: schema.researchers.id });
      if (!made) {
        return c.json({ error: `Sign in as ${found.email} to accept.` }, 401);
      }
      researcherId = made.id;
    }
    if (!(await useLink(db, found.id))) {
      return c.json(gone, 404);
    }
    await db
      .insert(schema.teamMemberships)
      .values({ teamId: found.teamId, researcherId, role: found.role })
      .onConflictDoUpdate({
        target: [schema.teamMemberships.teamId, schema.teamMemberships.researcherId],
        set: { role: found.role },
      });
    if (!account) {
      signIn(c, secureCookies, await createResearcherSession(db, researcherId));
    }
    return c.json({ ok: true as const }, 200);
  });

  return app;
}

/** Emails each owner of a team, quietly. For news about their lab on a hosted Truman. */
export async function emailOwners(
  db: Database,
  mailer: Mailer | undefined,
  teamId: string,
  subject: string,
  text: string,
) {
  const owners = await db
    .select({ email: schema.researchers.email })
    .from(schema.teamMemberships)
    .innerJoin(schema.researchers, eq(schema.researchers.id, schema.teamMemberships.researcherId))
    .where(
      and(eq(schema.teamMemberships.teamId, teamId), eq(schema.teamMemberships.role, "owner")),
    );
  for (const { email } of owners) {
    await sendQuietly(mailer, { to: email, subject, text });
  }
}

/** Emails every operator, quietly. */
export async function emailOperators(
  db: Database,
  mailer: Mailer | undefined,
  subject: string,
  text: string,
) {
  const operators = await db
    .select({ email: schema.researchers.email })
    .from(schema.researchers)
    .where(eq(schema.researchers.operator, true));
  for (const { email } of operators) {
    await sendQuietly(mailer, { to: email, subject, text });
  }
}
