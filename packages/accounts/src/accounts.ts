import { type Database, schema } from "@truman3/db";
import { and, eq, isNull } from "drizzle-orm";
import { generatePassword, hashPassword } from "./passwords.ts";

export type TeamRole = "owner" | "editor" | "viewer";

const normalizeEmail = (email: string) => email.trim().toLowerCase();

async function createOrFindResearcher(
  db: Database,
  { email, name }: { email: string; name: string },
): Promise<{ id: string; password: string | null }> {
  const normalized = normalizeEmail(email);
  const [existing] = await db
    .select()
    .from(schema.researchers)
    .where(eq(schema.researchers.email, normalized));
  if (existing) {
    return { id: existing.id, password: null };
  }

  const password = generatePassword();
  const [created] = await db
    .insert(schema.researchers)
    .values({ email: normalized, name, passwordHash: await hashPassword(password) })
    .returning({ id: schema.researchers.id });
  return { id: created?.id as string, password };
}

/**
 * Creates a team and its first owner, and gives it any studies that don't have a team yet. A
 * password comes back only for a new account, since it can't be read later.
 */
export async function setUpTeam(
  db: Database,
  request: { teamName: string; slug: string; email: string; name: string },
) {
  const [team] = await db
    .insert(schema.teams)
    .values({ name: request.teamName, slug: request.slug })
    .returning();
  if (!team) {
    throw new Error("The team wasn't created.");
  }

  const researcher = await createOrFindResearcher(db, request);
  await db
    .insert(schema.teamMemberships)
    .values({ teamId: team.id, researcherId: researcher.id, role: "owner" });

  const adopted = await db
    .update(schema.studies)
    .set({ teamId: team.id })
    .where(isNull(schema.studies.teamId))
    .returning({ id: schema.studies.id });

  return { teamId: team.id, password: researcher.password, studiesAdopted: adopted.length };
}

/** Adds someone to a team, creating their account if needed. */
export async function addResearcherToTeam(
  db: Database,
  request: { teamSlug: string; email: string; name: string; role: TeamRole },
) {
  const [team] = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.slug, request.teamSlug));
  if (!team) {
    return { status: "no-team" as const };
  }

  const researcher = await createOrFindResearcher(db, request);
  await db
    .insert(schema.teamMemberships)
    .values({ teamId: team.id, researcherId: researcher.id, role: request.role })
    .onConflictDoUpdate({
      target: [schema.teamMemberships.teamId, schema.teamMemberships.researcherId],
      set: { role: request.role },
    });

  return { status: "added" as const, password: researcher.password };
}

/** Sets a new password and signs them out everywhere. Returns null if there's no such account. */
export async function resetPassword(db: Database, email: string): Promise<string | null> {
  const password = generatePassword();
  const [updated] = await db
    .update(schema.researchers)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(schema.researchers.email, normalizeEmail(email)))
    .returning({ id: schema.researchers.id });
  if (!updated) {
    return null;
  }

  await db
    .delete(schema.researcherSessions)
    .where(eq(schema.researcherSessions.researcherId, updated.id));
  return password;
}

/** A researcher's role on a study's team, or null if they have no access to it. */
export async function roleOnStudy(
  db: Database,
  researcherId: string,
  studyId: string,
): Promise<TeamRole | null> {
  const [row] = await db
    .select({ role: schema.teamMemberships.role })
    .from(schema.studies)
    .innerJoin(schema.teamMemberships, eq(schema.teamMemberships.teamId, schema.studies.teamId))
    .where(
      and(eq(schema.studies.id, studyId), eq(schema.teamMemberships.researcherId, researcherId)),
    );
  return (row?.role as TeamRole | undefined) ?? null;
}

export function findResearcherByEmail(db: Database, email: string) {
  return db
    .select()
    .from(schema.researchers)
    .where(eq(schema.researchers.email, normalizeEmail(email)));
}
