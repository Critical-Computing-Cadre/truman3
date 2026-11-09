import { type Database, schema } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import { and, eq, sql } from "drizzle-orm";

export type WithdrawResult =
  | { status: "not-found" }
  | { status: "withdrawn"; eventsDeleted: number; filesDeleted: number };

/**
 * Deletes everything about a participant, including images they uploaded, and stops that ID from
 * entering this study again. The database goes first: if deleting files then fails, this reports
 * the error, and the files need removing by hand, under uploads/<world id>/<participant id>/.
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
    filesDeleted += await storage.deletePrefix(`uploads/${worldId}/${participantId}/`);
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

/** Why a study can't be deleted for good, or null if it can. The database checks the same. */
export async function whyNotDeletable(db: Database, studyId: string): Promise<string | null> {
  const [real] = await db
    .select({ id: schema.participants.id })
    .from(schema.participants)
    .where(and(eq(schema.participants.studyId, studyId), eq(schema.participants.isPilot, false)))
    .limit(1);
  if (real) {
    return "Real people took part in it, so its data is kept. It can stay archived.";
  }
  const [withdrawn] = await db.execute<{ found: number }>(
    sql`select 1 as found from data_deletions where study_id = ${studyId} and reason <> 'scenario test' limit 1`,
  );
  if (withdrawn) {
    return "It has withdrawals on record, which are kept. It can stay archived.";
  }
  const [paid] = await db.execute<{ found: number }>(
    sql`select 1 as found from prolific_actions where study_id = ${studyId}
        union all select 1 from prolific_bonuses where study_id = ${studyId} limit 1`,
  );
  if (paid) {
    return "It has Prolific payments on record, which are kept. It can stay archived.";
  }
  return null;
}

/**
 * Deletes an archived study for good, with its test participants and their uploads. The database
 * refuses a study that real people took part in. See ADR 58.
 */
export async function deleteStudy(
  db: Database,
  storage: Storage,
  studyId: string,
  requestedBy: string,
) {
  const worlds = await db
    .select({ worldId: schema.worlds.id })
    .from(schema.worlds)
    .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.worlds.studyVersionId))
    .where(eq(schema.studyVersions.studyId, studyId));
  await db.execute(sql`select delete_study(${studyId}, ${requestedBy})`);
  for (const { worldId } of worlds) {
    await storage.deletePrefix(`uploads/${worldId}/`);
  }
}
