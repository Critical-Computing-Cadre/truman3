import { type Database, schema } from "@truman3/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";

export type LaunchResult = { status: "launched"; version: number } | { status: "not-found" };

/**
 * Makes a frozen version the one new participants get. Saving a version doesn't do this, so a team
 * can check it first. People already enrolled stay on the version they started with.
 */
export async function launchVersion(
  db: Database,
  studyId: string,
  versionId: string,
  by: string,
): Promise<LaunchResult> {
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select({ id: schema.studyVersions.id, version: schema.studyVersions.version })
      .from(schema.studyVersions)
      .where(
        and(
          eq(schema.studyVersions.id, versionId),
          eq(schema.studyVersions.studyId, studyId),
          isNotNull(schema.studyVersions.frozenAt),
        ),
      );
    if (!version) {
      return { status: "not-found" as const };
    }

    await tx
      .update(schema.studies)
      .set({ liveVersionId: version.id })
      .where(eq(schema.studies.id, studyId));
    await tx
      .insert(schema.studyLaunches)
      .values({ studyId, versionId: version.id, action: "launch", by });
    return { status: "launched" as const, version: version.version };
  });
}

/** Closes a study to new participants. People already enrolled can still come back. */
export async function stopNewParticipants(db: Database, studyId: string, by: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.studies)
      .set({ liveVersionId: null })
      .where(eq(schema.studies.id, studyId));
    await tx.insert(schema.studyLaunches).values({ studyId, action: "stop", by });
  });
}

/** For the command line: finds a study and version by slug and number. Newest if no number. */
export async function findStudyVersion(db: Database, slug: string, versionNumber?: number) {
  const rows = await db
    .select({
      studyId: schema.studies.id,
      versionId: schema.studyVersions.id,
      version: schema.studyVersions.version,
    })
    .from(schema.studies)
    .innerJoin(schema.studyVersions, eq(schema.studyVersions.studyId, schema.studies.id))
    .where(eq(schema.studies.slug, slug))
    .orderBy(desc(schema.studyVersions.version));

  return versionNumber === undefined
    ? (rows[0] ?? null)
    : (rows.find((row) => row.version === versionNumber) ?? null);
}
