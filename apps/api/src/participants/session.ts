import { createHash, randomBytes } from "node:crypto";
import { type StudySettings, studySettingsSchema } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { and, desc, eq, gt, isNull, ne, or } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";

/** A neutral name, since participant-facing details shouldn't reveal this is a study. */
export const SESSION_COOKIE = "session";

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Everything about a signed-in participant that handling a request needs. */
export interface ParticipantContext {
  participantId: string;
  /** Their recruitment ID. Never send this to the browser, except inside an exit link. */
  externalId: string;
  studyVersionId: string;
  worldId: string;
  actorId: string;
  /** Their current condition, which can change in adaptive designs. */
  conditionId: string;
  conditionKey: string;
  worldStartedAt: Date;
  /** Whether others share their world (ADR 67), or it's theirs alone. */
  worldMode: "solo" | "shared";
  flowPosition: number;
  /** The world's random seed. */
  seed: number;
  settings: StudySettings;
}

/** The real time, which is what participants' clock is outside scenario tests. */
export const realClock = () => new Date();

/** Finds who a session token belongs to. Returns null if it's unknown, expired, or they're out. */
export async function loadParticipantContext(
  db: Database,
  token: string,
  now: Date,
): Promise<ParticipantContext | null> {
  const [row] = await db
    .select({
      participantId: schema.sessions.participantId,
      externalId: schema.participants.externalId,
      worldId: schema.worldMemberships.worldId,
      actorId: schema.worldMemberships.actorId,
      studyVersionId: schema.worlds.studyVersionId,
      worldStartedAt: schema.worlds.startedAt,
      worldMode: schema.worlds.mode,
      seed: schema.worlds.seed,
      flowPosition: schema.participants.flowPosition,
      settings: schema.studyVersions.settings,
    })
    .from(schema.sessions)
    .innerJoin(
      schema.worldMemberships,
      and(
        eq(schema.worldMemberships.participantId, schema.sessions.participantId),
        isNull(schema.worldMemberships.leftAt),
      ),
    )
    .innerJoin(schema.worlds, eq(schema.worlds.id, schema.worldMemberships.worldId))
    .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.worlds.studyVersionId))
    .innerJoin(schema.participants, eq(schema.participants.id, schema.sessions.participantId))
    .innerJoin(schema.studies, eq(schema.studies.id, schema.participants.studyId))
    .leftJoin(schema.teams, eq(schema.teams.id, schema.studies.teamId))
    .where(
      and(
        eq(schema.sessions.tokenHash, hashSessionToken(token)),
        gt(schema.sessions.expiresAt, now),
        eq(schema.participants.status, "active"),
        // A suspended team's studies stop at once, for everyone in them (ADR 70).
        or(isNull(schema.teams.status), ne(schema.teams.status, "suspended")),
      ),
    )
    .limit(1);
  if (!row) {
    return null;
  }

  const [assignment] = await db
    .select({ conditionId: schema.assignments.conditionId, conditionKey: schema.conditions.key })
    .from(schema.assignments)
    .innerJoin(schema.conditions, eq(schema.conditions.id, schema.assignments.conditionId))
    .where(eq(schema.assignments.participantId, row.participantId))
    .orderBy(desc(schema.assignments.id))
    .limit(1);
  if (!assignment) {
    return null;
  }

  return {
    ...row,
    ...assignment,
    worldMode: row.worldMode as ParticipantContext["worldMode"],
    settings: studySettingsSchema.parse(row.settings),
  };
}

/** The signed-in participant for a request, or null. */
export async function participantFromRequest(
  c: Context,
  db: Database,
  now: Date,
): Promise<ParticipantContext | null> {
  const token = getCookie(c, SESSION_COOKIE);
  return token ? loadParticipantContext(db, token, now) : null;
}

/**
 * Someone's context from their world rather than their session, for what a researcher does in it,
 * such as approving a beat. Null if nobody is in that world now.
 */
export async function loadWorldContext(
  db: Database,
  worldId: string,
  /** In a shared world, whose context: one of its participants, by their actor. */
  actorId?: string | null,
): Promise<ParticipantContext | null> {
  const [row] = await db
    .select({
      participantId: schema.worldMemberships.participantId,
      externalId: schema.participants.externalId,
      worldId: schema.worldMemberships.worldId,
      actorId: schema.worldMemberships.actorId,
      studyVersionId: schema.worlds.studyVersionId,
      worldStartedAt: schema.worlds.startedAt,
      worldMode: schema.worlds.mode,
      seed: schema.worlds.seed,
      flowPosition: schema.participants.flowPosition,
      settings: schema.studyVersions.settings,
    })
    .from(schema.worldMemberships)
    .innerJoin(schema.worlds, eq(schema.worlds.id, schema.worldMemberships.worldId))
    .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.worlds.studyVersionId))
    .innerJoin(
      schema.participants,
      eq(schema.participants.id, schema.worldMemberships.participantId),
    )
    .where(
      and(
        eq(schema.worldMemberships.worldId, worldId),
        isNull(schema.worldMemberships.leftAt),
        actorId ? eq(schema.worldMemberships.actorId, actorId) : undefined,
      ),
    )
    .limit(1);
  if (!row) {
    return null;
  }
  const [assignment] = await db
    .select({ conditionId: schema.assignments.conditionId, conditionKey: schema.conditions.key })
    .from(schema.assignments)
    .innerJoin(schema.conditions, eq(schema.conditions.id, schema.assignments.conditionId))
    .where(eq(schema.assignments.participantId, row.participantId))
    .orderBy(desc(schema.assignments.id))
    .limit(1);
  return assignment
    ? {
        ...row,
        ...assignment,
        worldMode: row.worldMode as ParticipantContext["worldMode"],
        settings: studySettingsSchema.parse(row.settings),
      }
    : null;
}
