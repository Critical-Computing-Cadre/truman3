import { type Database, schema } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import { and, eq, sql } from "drizzle-orm";

export type WithdrawResult =
  | { status: "not-found" }
  | { status: "withdrawn"; eventsDeleted: number; filesDeleted: number };

/**
 * Deletes everything about a participant, including images they uploaded, and stops that ID from
 * entering this study again. The database goes first: if deleting files then fails, this reports
 * the error, and the files need removing by hand, under uploads/<world id>/.
 */
export async function deleteParticipant(
  db: Database,
  storage: Storage,
  participantId: string,
  reason: string,
  requestedBy: string,
) {
  const worlds = await db
    .select({ worldId: schema.worldMemberships.worldId })
    .from(schema.worldMemberships)
    .where(eq(schema.worldMemberships.participantId, participantId));

  const [row] = await db.execute<{ deleted: number }>(
    sql`select delete_participant_data(${participantId}, ${reason}, ${requestedBy}) as deleted`,
  );

  let filesDeleted = 0;
  for (const { worldId } of worlds) {
    filesDeleted += await storage.deletePrefix(`uploads/${worldId}/`);
  }

  return { eventsDeleted: Number(row?.deleted ?? 0), filesDeleted };
}

/** Finds a participant by their recruitment ID and deletes them. */
export async function withdrawParticipant(
  db: Database,
  storage: Storage,
  request: { slug: string; externalId: string; reason: string; requestedBy: string },
): Promise<WithdrawResult> {
  const [participant] = await db
    .select({ id: schema.participants.id })
    .from(schema.participants)
    .innerJoin(schema.studies, eq(schema.studies.id, schema.participants.studyId))
    .where(
      and(
        eq(schema.studies.slug, request.slug),
        eq(schema.participants.externalId, request.externalId),
      ),
    );
  if (!participant) {
    return { status: "not-found" };
  }

  const deleted = await deleteParticipant(
    db,
    storage,
    participant.id,
    request.reason,
    request.requestedBy,
  );
  return { status: "withdrawn", ...deleted };
}
