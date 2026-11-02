import { createHash, randomBytes } from "node:crypto";
import { type Database, schema } from "@truman3/db";
import { and, desc, eq, gt, isNull } from "drizzle-orm";

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
  studyVersionId: string;
  worldId: string;
  actorId: string;
  /** Their current condition, which can change in adaptive designs. */
  conditionId: string;
  worldStartedAt: Date;
}

/** Finds who a session token belongs to. Returns null if it's unknown or expired. */
export async function loadParticipantContext(
  db: Database,
  token: string,
  now = new Date(),
): Promise<ParticipantContext | null> {
  const [row] = await db
    .select({
      participantId: schema.sessions.participantId,
      worldId: schema.worldMemberships.worldId,
      actorId: schema.worldMemberships.actorId,
      studyVersionId: schema.worlds.studyVersionId,
      worldStartedAt: schema.worlds.startedAt,
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
    .where(
      and(
        eq(schema.sessions.tokenHash, hashSessionToken(token)),
        gt(schema.sessions.expiresAt, now),
      ),
    )
    .limit(1);
  if (!row) {
    return null;
  }

  const [assignment] = await db
    .select({ conditionId: schema.assignments.conditionId })
    .from(schema.assignments)
    .where(eq(schema.assignments.participantId, row.participantId))
    .orderBy(desc(schema.assignments.id))
    .limit(1);
  if (!assignment) {
    return null;
  }

  return { ...row, conditionId: assignment.conditionId };
}
