import { createHash, randomInt, randomUUID } from "node:crypto";
import {
  armProbability,
  blockedArm,
  featureOn,
  pickUniformArm,
  type StudySettings,
  studySettingsSchema,
} from "@truman3/core";
import { type Database, recordEvent, schema, type Transaction } from "@truman3/db";
import { and, asc, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { DeviceSummary } from "./device.ts";
import { hashSessionToken, newSessionToken } from "./session.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long past the end of a study a session lasts, for people finishing late. */
const SESSION_GRACE_DAYS = 7;
const MAX_SEED = 2 ** 31;
const RANDOM_RANGE = 2 ** 32;

type VersionRow = typeof schema.studyVersions.$inferSelect;

/** A study, and the version new participants get, if it's open to them. */
export async function findStudyEntry(db: Database | Transaction, slug: string) {
  const [study] = await db.select().from(schema.studies).where(eq(schema.studies.slug, slug));
  if (!study) {
    return null;
  }
  if (!study.liveVersionId) {
    return { studyId: study.id, live: null };
  }
  const [version] = await db
    .select()
    .from(schema.studyVersions)
    .where(eq(schema.studyVersions.id, study.liveVersionId));
  if (!version) {
    return { studyId: study.id, live: null };
  }
  return {
    studyId: study.id,
    live: { version, settings: studySettingsSchema.parse(version.settings) },
  };
}

/**
 * What an entry page shows. When a study has closed to new people, those already in it still need a
 * way back, so this falls back to the version it last had open. A study that's never been open has
 * nothing to show.
 */
export async function entrySettings(db: Database, slug: string): Promise<StudySettings | null> {
  const entry = await findStudyEntry(db, slug);
  if (!entry) {
    return null;
  }
  if (entry.live) {
    return entry.live.settings;
  }
  const [last] = await db
    .select({ settings: schema.studyVersions.settings })
    .from(schema.studyLaunches)
    .innerJoin(schema.studyVersions, eq(schema.studyVersions.id, schema.studyLaunches.versionId))
    .where(eq(schema.studyLaunches.studyId, entry.studyId))
    .orderBy(desc(schema.studyLaunches.id))
    .limit(1);
  return last ? studySettingsSchema.parse(last.settings) : null;
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

/** A new participant's own world, and an actor to act as. */
async function createWorld(
  tx: Transaction,
  version: VersionRow,
  participantId: string,
  now: Date,
  seed = randomInt(MAX_SEED),
) {
  const [world] = await tx
    .insert(schema.worlds)
    .values({ studyVersionId: version.id, seed, startedAt: now })
    .returning();
  if (!world) {
    throw new Error("The world wasn't created.");
  }
  return joinWorld(tx, version, world, participantId);
}

/** An actor for a participant in a world, solo or shared, and their membership in it. */
async function joinWorld(
  tx: Transaction,
  version: VersionRow,
  world: typeof schema.worlds.$inferSelect,
  participantId: string,
) {
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

  return { worldId: world.id, actorId: actor.id, startedAt: world.startedAt };
}

/**
 * A "tagged you" notification for each post the study tagged the participant in, in their condition,
 * due when the post appears. Written now, like any scheduled outcome, so nothing runs later.
 */
async function notifyTags(
  tx: Transaction,
  versionId: string,
  settings: StudySettings,
  conditionKey: string,
  world: { worldId: string; actorId: string; startedAt: Date },
) {
  if (!featureOn(settings, conditionKey, "photoTags")) {
    return;
  }
  const tagged = (
    await tx
      .select()
      .from(schema.content)
      .where(
        and(
          eq(schema.content.studyVersionId, versionId),
          isNull(schema.content.worldId),
          eq(schema.content.kind, "post"),
          eq(schema.content.tagsParticipant, true),
        ),
      )
  ).filter(({ conditions }) => conditions.length === 0 || conditions.includes(conditionKey));
  if (tagged.length > 0) {
    await tx.insert(schema.notifications).values(
      tagged.map((post) => ({
        worldId: world.worldId,
        recipientActorId: world.actorId,
        actorId: post.authorActorId,
        type: "tag",
        targetContentId: post.id,
        dueAt: new Date(world.startedAt.getTime() + (post.offsetMs ?? 0)),
      })),
    );
  }
}

/** Everything a new participant needs: a condition, their own world, and an actor to act as. */
/**
 * A place in a shared world (ADR 67): the oldest one still waiting for people, or a new one. A world
 * waits until it's full or `waitMinutes` have passed, and starts then, so everyone's study time
 * starts together. Its condition is drawn when it's made, and everyone who joins it gets it.
 */
async function joinSharedWorld(
  tx: Transaction,
  version: VersionRow,
  settings: StudySettings,
  shared: NonNullable<StudySettings["worlds"]>,
  participantId: string,
  now: Date,
) {
  // Locked, so two people joining at once can't both take its last place.
  const [open] = await tx
    .select()
    .from(schema.worlds)
    .where(
      and(
        eq(schema.worlds.studyVersionId, version.id),
        eq(schema.worlds.mode, "shared"),
        isNull(schema.worlds.closedAt),
        gt(schema.worlds.startedAt, now),
      ),
    )
    .orderBy(asc(schema.worlds.startedAt))
    .limit(1)
    .for("update");

  let world = open;
  let condition: typeof schema.conditions.$inferSelect;
  if (world?.conditionId) {
    const [found] = await tx
      .select()
      .from(schema.conditions)
      .where(eq(schema.conditions.id, world.conditionId));
    condition = found as typeof schema.conditions.$inferSelect;
    const arms = settings.conditions.arms.map(({ key, weight }) => ({ key, weight }));
    // Their condition is the world's, which was drawn with this chance when it was made.
    await tx.insert(schema.assignments).values({
      participantId,
      studyVersionId: version.id,
      conditionId: condition.id,
      method: "world",
      probability: armProbability(arms, condition.key),
      details: { worldId: world.id },
    });
  } else {
    condition = await assignCondition(tx, version, settings, participantId);
    const [made] = await tx
      .insert(schema.worlds)
      .values({
        studyVersionId: version.id,
        mode: "shared",
        seed: randomInt(MAX_SEED),
        startedAt: new Date(now.getTime() + shared.waitMinutes * 60_000),
        conditionId: condition.id,
      })
      .returning();
    if (!made) {
      throw new Error("The world wasn't created.");
    }
    world = made;
  }
  const place = await joinWorld(tx, version, world, participantId);

  // Full, it starts now, if that's sooner than its wait would have ended.
  const [members] = await tx
    .select({ total: count() })
    .from(schema.worldMemberships)
    .where(eq(schema.worldMemberships.worldId, world.id));
  if ((members?.total ?? 0) >= shared.size && world.startedAt > now) {
    await tx.update(schema.worlds).set({ startedAt: now }).where(eq(schema.worlds.id, world.id));
    place.startedAt = now;
  }
  return { condition, world: place };
}

async function enroll(
  tx: Transaction,
  version: VersionRow,
  settings: StudySettings,
  participantId: string,
  now: Date,
) {
  const joined = settings.worlds
    ? await joinSharedWorld(tx, version, settings, settings.worlds, participantId, now)
    : {
        condition: await assignCondition(tx, version, settings, participantId),
        world: await createWorld(tx, version, participantId, now),
      };
  const { condition, world } = joined;

  // Who someone starts out following is the study's choice. After this it's theirs.
  if (featureOn(settings, condition.key, "following")) {
    const cast = await tx
      .select()
      .from(schema.actors)
      .where(and(eq(schema.actors.studyVersionId, version.id), isNull(schema.actors.worldId)));
    const followed = cast.filter((actor) => {
      const { startsFollowed } = actor.profile as { startsFollowed?: boolean | string[] };
      return Array.isArray(startsFollowed)
        ? startsFollowed.includes(condition.key)
        : startsFollowed === true;
    });
    if (followed.length > 0) {
      await tx.insert(schema.actorRelations).values(
        followed.map((actor) => ({
          worldId: world.worldId,
          actorId: world.actorId,
          targetActorId: actor.id,
          kind: "follow",
        })),
      );
    }
  }
  await notifyTags(tx, version.id, settings, condition.key, world);

  return { ...world, conditionId: condition.id };
}

/**
 * Starts a test participant for a researcher, in a condition they choose, on any version. It goes
 * around assignment, so it doesn't use up a block position, and it's kept out of exports.
 */
/**
 * A test participant in a chosen condition. A simulation gives the world's seed, so a run with the
 * same seed is the same run; otherwise it's random, like a real participant's.
 */
export async function startPilot(
  db: Database,
  versionId: string,
  conditionKey: string,
  now: Date,
  worldSeed?: number,
) {
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(schema.studyVersions)
      .where(eq(schema.studyVersions.id, versionId));
    const [condition] = await tx
      .select()
      .from(schema.conditions)
      .where(
        and(
          eq(schema.conditions.studyVersionId, versionId),
          eq(schema.conditions.key, conditionKey),
        ),
      );
    if (!version || !condition) {
      return null;
    }

    const [participant] = await tx
      .insert(schema.participants)
      .values({
        studyId: version.studyId,
        externalId: `pilot-${randomUUID()}`,
        source: "pilot",
        isPilot: true,
      })
      .returning();
    const participantId = participant?.id as string;

    await tx.insert(schema.assignments).values({
      participantId,
      studyVersionId: version.id,
      conditionId: condition.id,
      method: "pilot",
      probability: 1,
    });
    const place = await createWorld(tx, version, participantId, now, worldSeed);

    const settings = studySettingsSchema.parse(version.settings);
    await notifyTags(tx, version.id, settings, condition.key, place);
    const token = newSessionToken();
    await tx.insert(schema.sessions).values({
      tokenHash: hashSessionToken(token),
      participantId,
      expiresAt: new Date(now.getTime() + (settings.length.days + SESSION_GRACE_DAYS) * DAY_MS),
    });
    await recordEvent(tx, {
      type: "session.started",
      payload: { device: "unknown", browser: "pilot" },
      worldId: place.worldId,
      studyVersionId: version.id,
      participantId,
      conditionId: condition.id,
      actorId: place.actorId,
      source: "researcher",
      occurredAt: now,
    });
    return { token };
  });
}

export interface EnterRequest {
  slug: string;
  externalId: string;
  device: DeviceSummary;
  /** Only called if the study has turned on storing IP addresses. */
  getIpAddress: () => string | undefined;
  now?: Date;
}

export type EnterResult =
  | { status: "signed-in"; returning: boolean; token: string; expiresAt: Date }
  /** They've finished or withdrawn. Either way, they're out of this study for good. */
  | { status: "refused" }
  /** The study isn't taking new participants right now. */
  | { status: "closed" };

/** Matches the hash in the delete_participant_data database function. */
function exclusionHash(studyId: string, externalId: string): string {
  return createHash("sha256").update(`${studyId}:${externalId}`).digest("hex");
}

/**
 * Enrolls someone the first time they enter with an ID, and signs them back in after that (ADR 9).
 * Returns null if there's no such study. New people get the launched version. People who've already
 * started stay on theirs, whatever gets launched later, and can return even if the study has closed.
 */
export async function enterStudy(db: Database, request: EnterRequest): Promise<EnterResult | null> {
  const now = request.now ?? new Date();

  return db.transaction(async (tx) => {
    const entry = await findStudyEntry(tx, request.slug);
    if (!entry) {
      return null;
    }
    const { studyId, live } = entry;

    const [excluded] = await tx
      .select()
      .from(schema.excludedEntries)
      .where(
        and(
          eq(schema.excludedEntries.studyId, studyId),
          eq(schema.excludedEntries.idHash, exclusionHash(studyId, request.externalId)),
        ),
      );
    if (excluded) {
      return { status: "refused" };
    }

    const [created] = live
      ? await tx
          .insert(schema.participants)
          .values({
            studyId,
            externalId: request.externalId,
            source: live.settings.entry.source,
          })
          .onConflictDoNothing()
          .returning()
      : [];

    let participantId: string;
    let version: VersionRow;
    let settings: StudySettings;
    let place: { worldId: string; actorId: string; conditionId: string };

    if (created && live) {
      participantId = created.id;
      version = live.version;
      settings = live.settings;
      place = await enroll(tx, version, settings, participantId, now);
    } else {
      const [existing] = await tx
        .select({
          participantId: schema.participants.id,
          status: schema.participants.status,
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
            eq(schema.participants.studyId, studyId),
            eq(schema.participants.externalId, request.externalId),
          ),
        );
      if (!existing && !live) {
        return { status: "closed" };
      }
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
      if (existing.status !== "active") {
        return { status: "refused" };
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

    return { status: "signed-in", returning: !created, token, expiresAt };
  });
}
