import { randomInt } from "node:crypto";
import {
  armProbability,
  blockedArm,
  pickUniformArm,
  type StudySettings,
  studySettingsSchema,
} from "@truman3/core";
import { type Database, recordEvent, schema, type Transaction } from "@truman3/db";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { DeviceSummary } from "./device.ts";
import { hashSessionToken, newSessionToken } from "./session.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long past the end of a study a session lasts, for people finishing late. */
const SESSION_GRACE_DAYS = 7;
const MAX_SEED = 2 ** 31;
const RANDOM_RANGE = 2 ** 32;

type VersionRow = typeof schema.studyVersions.$inferSelect;

/** The newest frozen version of a study, which is what new participants get. */
export async function latestFrozenVersion(
  db: Database | Transaction,
  slug: string,
): Promise<{ studyId: string; version: VersionRow; settings: StudySettings } | null> {
  const [row] = await db
    .select({ version: schema.studyVersions, studyId: schema.studies.id })
    .from(schema.studyVersions)
    .innerJoin(schema.studies, eq(schema.studies.id, schema.studyVersions.studyId))
    .where(and(eq(schema.studies.slug, slug), isNotNull(schema.studyVersions.frozenAt)))
    .orderBy(desc(schema.studyVersions.version))
    .limit(1);

  return row
    ? {
        studyId: row.studyId,
        version: row.version,
        settings: studySettingsSchema.parse(row.version.settings),
      }
    : null;
}

async function assignCondition(
  tx: Transaction,
  version: VersionRow,
  settings: StudySettings,
  participantId: string,
) {
  const conditions = await tx
    .select()
    .from(schema.conditions)
    .where(eq(schema.conditions.studyVersionId, version.id));

  // Keep the order from the study definition, so a seed always gives the same sequence.
  const arms = settings.conditions.arms.map(({ key, weight }) => ({ key, weight }));
  const { assignment } = settings.conditions;

  let arm: string;
  let details: Record<string, number> = {};
  if (assignment.method === "blocked") {
    // This locks the row until the transaction ends, so two people can't get the same position.
    const [counter] = await tx
      .update(schema.assignmentCounters)
      .set({ nextPosition: sql`${schema.assignmentCounters.nextPosition} + 1` })
      .where(eq(schema.assignmentCounters.studyVersionId, version.id))
      .returning({ next: schema.assignmentCounters.nextPosition });
    if (!counter) {
      throw new Error(`Study version ${version.id} has no assignment counter.`);
    }
    const position = counter.next - 1;
    const result = blockedArm(arms, assignment.blockSize, version.seed, position);
    arm = result.arm;
    details = { position, block: result.block, positionInBlock: result.positionInBlock };
  } else {
    arm = pickUniformArm(arms, randomInt(RANDOM_RANGE) / RANDOM_RANGE);
  }

  const condition = conditions.find(({ key }) => key === arm);
  if (!condition) {
    throw new Error(`Study version ${version.id} has no condition called "${arm}".`);
  }

  await tx.insert(schema.assignments).values({
    participantId,
    studyVersionId: version.id,
    conditionId: condition.id,
    method: assignment.method,
    probability: armProbability(arms, arm),
    details,
  });

  return condition;
}

/** Everything a new participant needs: a condition, their own world, and an actor to act as. */
async function enroll(
  tx: Transaction,
  version: VersionRow,
  settings: StudySettings,
  participantId: string,
) {
  const condition = await assignCondition(tx, version, settings, participantId);

  const [world] = await tx
    .insert(schema.worlds)
    .values({ studyVersionId: version.id, seed: randomInt(MAX_SEED) })
    .returning();
  if (!world) {
    throw new Error("The world wasn't created.");
  }

  const [actor] = await tx
    .insert(schema.actors)
    .values({
      studyVersionId: version.id,
      worldId: world.id,
      participantId,
      // Replaced when they create their account.
      username: `user-${participantId.slice(-12)}`,
      driver: "human",
    })
    .returning();
  if (!actor) {
    throw new Error("The actor wasn't created.");
  }

  await tx
    .insert(schema.worldMemberships)
    .values({ worldId: world.id, participantId, actorId: actor.id });

  return { worldId: world.id, actorId: actor.id, conditionId: condition.id };
}

export interface EnterRequest {
  slug: string;
  externalId: string;
  device: DeviceSummary;
  /** Only called if the study has turned on storing IP addresses. */
  getIpAddress: () => string | undefined;
  now?: Date;
}

export interface EnterResult {
  returning: boolean;
  token: string;
  expiresAt: Date;
}

/**
 * Enrolls someone the first time they enter with an ID, and signs them back in after that (ADR 9).
 * Returns null if there's no such study. People who've already started stay on their version, even
 * if a newer one has been imported.
 */
export async function enterStudy(db: Database, request: EnterRequest): Promise<EnterResult | null> {
  const now = request.now ?? new Date();

  return db.transaction(async (tx) => {
    const latest = await latestFrozenVersion(tx, request.slug);
    if (!latest) {
      return null;
    }

    const [created] = await tx
      .insert(schema.participants)
      .values({
        studyId: latest.studyId,
        externalId: request.externalId,
        source: latest.settings.entry.source,
      })
      .onConflictDoNothing()
      .returning();

    let participantId: string;
    let version: VersionRow;
    let settings: StudySettings;
    let place: { worldId: string; actorId: string; conditionId: string };

    if (created) {
      participantId = created.id;
      version = latest.version;
      settings = latest.settings;
      place = await enroll(tx, version, settings, participantId);
    } else {
      const [existing] = await tx
        .select({
          participantId: schema.participants.id,
          worldId: schema.worldMemberships.worldId,
          actorId: schema.worldMemberships.actorId,
          version: schema.studyVersions,
        })
        .from(schema.participants)
        .innerJoin(
          schema.worldMemberships,
          eq(schema.worldMemberships.participantId, schema.participants.id),
        )
        .innerJoin(schema.worlds, eq(schema.worlds.id, schema.worldMemberships.worldId))
        .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.worlds.studyVersionId))
        .where(
          and(
            eq(schema.participants.studyId, latest.studyId),
            eq(schema.participants.externalId, request.externalId),
          ),
        );
      const [assignment] = existing
        ? await tx
            .select({ conditionId: schema.assignments.conditionId })
            .from(schema.assignments)
            .where(eq(schema.assignments.participantId, existing.participantId))
            .orderBy(desc(schema.assignments.id))
            .limit(1)
        : [];
      if (!existing || !assignment) {
        throw new Error("This participant exists but has no world or assignment.");
      }

      participantId = existing.participantId;
      version = existing.version;
      settings = studySettingsSchema.parse(existing.version.settings);
      place = { ...existing, conditionId: assignment.conditionId };
    }

    const token = newSessionToken();
    const expiresAt = new Date(
      now.getTime() + (settings.length.days + SESSION_GRACE_DAYS) * DAY_MS,
    );
    await tx
      .insert(schema.sessions)
      .values({ tokenHash: hashSessionToken(token), participantId, expiresAt });

    const ipAddress = settings.privacy.storeIpAddress ? request.getIpAddress() : undefined;
    await recordEvent(tx, {
      type: "session.started",
      payload: { ...request.device, ...(ipAddress ? { ipAddress } : {}) },
      worldId: place.worldId,
      studyVersionId: version.id,
      participantId,
      conditionId: place.conditionId,
      actorId: place.actorId,
      source: "participant",
      occurredAt: now,
    });

    return { returning: !created, token, expiresAt };
  });
}
