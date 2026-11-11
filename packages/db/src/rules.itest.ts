import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordEvent } from "./events.ts";
import {
  actors,
  assignments,
  conditions,
  content,
  dataDeletions,
  events,
  feedImpressions,
  participants,
  studies,
  studyVersions,
  worldMemberships,
  worlds,
} from "./schema.ts";
import { createTestDatabase } from "./testing.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: typeof database.db;

/** Postgres errors arrive wrapped by Drizzle, with the real message in `cause`. */
async function failureOf(action: () => PromiseLike<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    const { message, cause } = error as Error & { cause?: Error };
    return cause?.message ?? message;
  }
  throw new Error("Expected this to fail, but it succeeded.");
}

let counter = 0;

/** A study version with two conditions, one scripted actor, and one scripted post. */
async function createVersion({ frozen = false } = {}) {
  counter += 1;
  const [study] = await db
    .insert(studies)
    .values({ slug: `study-${counter}` })
    .returning();
  const [version] = await db
    .insert(studyVersions)
    .values({
      studyId: study!.id,
      version: 1,
      settings: {},
      contentHash: "hash",
      seed: 1,
    })
    .returning();
  const [conditionA, conditionB] = await db
    .insert(conditions)
    .values([
      { studyVersionId: version!.id, key: "a" },
      { studyVersionId: version!.id, key: "b" },
    ])
    .returning();
  const [castActor] = await db
    .insert(actors)
    .values({ studyVersionId: version!.id, username: "ann", driver: "scripted" })
    .returning();
  const [post] = await db
    .insert(content)
    .values({
      studyVersionId: version!.id,
      authorActorId: castActor!.id,
      kind: "post",
      body: "scripted",
      offsetMs: 0,
    })
    .returning();

  if (frozen) {
    await db
      .update(studyVersions)
      .set({ frozenAt: new Date() })
      .where(eq(studyVersions.id, version!.id));
  }

  return {
    study: study!,
    version: version!,
    conditionA: conditionA!,
    conditionB: conditionB!,
    castActor: castActor!,
    post: post!,
  };
}

/** A participant in their own world, with an assignment and an actor. */
async function enroll(
  setup: Awaited<ReturnType<typeof createVersion>>,
  externalId = "P1",
  mode = "solo",
) {
  const [participant] = await db
    .insert(participants)
    .values({ studyId: setup.study.id, externalId, source: "test" })
    .returning();
  const [world] = await db
    .insert(worlds)
    .values({ studyVersionId: setup.version.id, seed: 1, mode })
    .returning();
  const [actor] = await db
    .insert(actors)
    .values({
      studyVersionId: setup.version.id,
      worldId: world!.id,
      participantId: participant!.id,
      username: `me-${externalId}`,
      driver: "human",
    })
    .returning();
  await db
    .insert(worldMemberships)
    .values({ worldId: world!.id, participantId: participant!.id, actorId: actor!.id });
  await db.insert(assignments).values({
    participantId: participant!.id,
    studyVersionId: setup.version.id,
    conditionId: setup.conditionA.id,
    method: "uniform",
    probability: 0.5,
  });

  return { participant: participant!, world: world!, actor: actor! };
}

function like(
  setup: Awaited<ReturnType<typeof createVersion>>,
  person: Awaited<ReturnType<typeof enroll>>,
  clientEventId?: string,
) {
  return recordEvent(db, {
    type: "content.liked",
    payload: {},
    worldId: person.world.id,
    studyVersionId: setup.version.id,
    participantId: person.participant.id,
    conditionId: setup.conditionA.id,
    actorId: person.actor.id,
    targetContentId: setup.post.id,
    source: "participant",
    occurredAt: new Date(),
    ...(clientEventId ? { clientEventId } : {}),
  });
}

beforeAll(async () => {
  database = await createTestDatabase({ asOwner: true });
  db = database.db;
});

afterAll(async () => {
  await database.destroy();
});

describe("recording events", () => {
  it("writes an event, including one aimed at scripted content", async () => {
    const setup = await createVersion();
    const person = await enroll(setup);

    const result = await like(setup, person);
    const [row] = await db.select().from(events).where(eq(events.id, result!.id));

    expect(row).toMatchObject({
      type: "content.liked",
      source: "participant",
      targetContentId: setup.post.id,
      conditionId: setup.conditionA.id,
    });
  });

  it("ignores a repeat of the same client event, so retries don't double count", async () => {
    const setup = await createVersion();
    const person = await enroll(setup);
    const clientEventId = "01900000-0000-7000-8000-000000000001";

    expect(await like(setup, person, clientEventId)).not.toBeNull();
    expect(await like(setup, person, clientEventId)).toBeNull();

    const rows = await db.select().from(events).where(eq(events.worldId, person.world.id));
    expect(rows).toHaveLength(1);
  });

  it("doesn't treat events with no client ID as repeats", async () => {
    const setup = await createVersion();
    const person = await enroll(setup);

    await like(setup, person);
    await like(setup, person);

    const rows = await db.select().from(events).where(eq(events.worldId, person.world.id));
    expect(rows).toHaveLength(2);
  });

  it("rejects a payload that doesn't match the catalog", async () => {
    const setup = await createVersion();
    const person = await enroll(setup);

    await expect(
      recordEvent(db, {
        type: "content.viewed",
        // @ts-expect-error A wrong payload is a type error, and also fails when it runs.
        payload: { dwellMs: "long" },
        worldId: person.world.id,
        studyVersionId: setup.version.id,
        source: "participant",
        occurredAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});

describe("the event log is append-only", () => {
  it("blocks updating, deleting, and truncating events", async () => {
    const setup = await createVersion();
    await like(setup, await enroll(setup));

    expect(await failureOf(() => db.update(events).set({ type: "x" }))).toContain("append-only");
    expect(await failureOf(() => db.delete(events))).toContain("append-only");
    expect(await failureOf(() => db.execute(sql`truncate events cascade`))).toContain(
      "append-only",
    );
  });

  it("blocks changing assignments", async () => {
    const setup = await createVersion();
    await enroll(setup);

    expect(await failureOf(() => db.update(assignments).set({ probability: 1 }))).toContain(
      "append-only",
    );
    expect(await failureOf(() => db.delete(assignments))).toContain("append-only");
  });

  it("still blocks updates when the deletion setting is on", async () => {
    const setup = await createVersion();
    await like(setup, await enroll(setup));

    const failure = await failureOf(() =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('truman.allow_participant_deletion', 'on', true)`);
        await tx.update(events).set({ type: "x" });
      }),
    );
    expect(failure).toContain("append-only");
  });
});

describe("frozen study versions", () => {
  it("blocks changing or deleting the version", async () => {
    const { version } = await createVersion({ frozen: true });

    expect(
      await failureOf(() =>
        db
          .update(studyVersions)
          .set({ settings: { changed: true } })
          .where(eq(studyVersions.id, version.id)),
      ),
    ).toContain("frozen");
    expect(
      await failureOf(() => db.delete(studyVersions).where(eq(studyVersions.id, version.id))),
    ).toContain("frozen");
  });

  it("blocks changing its conditions, cast, and scripted content", async () => {
    const { conditionA, castActor, post, version } = await createVersion({ frozen: true });

    expect(
      await failureOf(() =>
        db.update(conditions).set({ key: "z" }).where(eq(conditions.id, conditionA.id)),
      ),
    ).toContain("frozen");
    expect(
      await failureOf(() =>
        db.update(actors).set({ username: "z" }).where(eq(actors.id, castActor.id)),
      ),
    ).toContain("frozen");
    expect(
      await failureOf(() => db.update(content).set({ body: "z" }).where(eq(content.id, post.id))),
    ).toContain("frozen");
    expect(
      await failureOf(() =>
        db.insert(content).values({
          studyVersionId: version.id,
          authorActorId: castActor.id,
          kind: "post",
          offsetMs: 1,
        }),
      ),
    ).toContain("frozen");
  });

  it("still allows what happens during a study", async () => {
    const setup = await createVersion({ frozen: true });
    const person = await enroll(setup);

    await db.insert(content).values({
      studyVersionId: setup.version.id,
      worldId: person.world.id,
      authorActorId: person.actor.id,
      kind: "post",
      body: "mine",
      visibleAt: new Date(),
    });

    const rows = await db.select().from(content).where(eq(content.worldId, person.world.id));
    expect(rows).toHaveLength(1);
  });
});

describe("other rules", () => {
  it("blocks the same recruitment ID enrolling twice in a study", async () => {
    const setup = await createVersion();
    await enroll(setup, "same");

    expect(await failureOf(() => enroll(setup, "same"))).toContain("duplicate key");
  });

  it("blocks assigning a participant to another version's condition", async () => {
    const first = await createVersion();
    const second = await createVersion();
    const person = await enroll(first);

    const failure = await failureOf(() =>
      db.insert(assignments).values({
        participantId: person.participant.id,
        studyVersionId: first.version.id,
        conditionId: second.conditionA.id,
        method: "uniform",
        probability: 0.5,
      }),
    );
    expect(failure).toContain("foreign key");
  });

  it("blocks scripted content with no time", async () => {
    const { version, castActor } = await createVersion();

    const failure = await failureOf(() =>
      db.insert(content).values({
        studyVersionId: version.id,
        authorActorId: castActor.id,
        kind: "post",
      }),
    );
    expect(failure).toContain("content_timing");
  });
});

describe("deleting a participant's data", () => {
  const deleteData = (participantId: string) =>
    db.execute(sql`select delete_participant_data(${participantId}, 'withdrew', 'researcher')`);

  it("removes everything about them, including what they wrote, and records it", async () => {
    const setup = await createVersion({ frozen: true });
    const person = await enroll(setup);
    await like(setup, person);
    const [theirPost] = await db
      .insert(content)
      .values({
        studyVersionId: setup.version.id,
        worldId: person.world.id,
        authorActorId: person.actor.id,
        kind: "post",
        body: "something personal",
        visibleAt: new Date(),
      })
      .returning();
    await db.insert(content).values({
      studyVersionId: setup.version.id,
      worldId: person.world.id,
      parentId: theirPost!.id,
      authorActorId: setup.castActor.id,
      kind: "comment",
      body: "a scripted reply to it",
      visibleAt: new Date(),
    });
    await db.insert(feedImpressions).values({
      worldId: person.world.id,
      viewerActorId: person.actor.id,
      ranker: "chronological",
      rankerVersion: "1",
      items: [],
    });

    await deleteData(person.participant.id);

    const id = person.participant.id;
    const worldId = person.world.id;
    expect(await db.select().from(participants).where(eq(participants.id, id))).toEqual([]);
    expect(await db.select().from(events).where(eq(events.participantId, id))).toEqual([]);
    expect(await db.select().from(assignments).where(eq(assignments.participantId, id))).toEqual(
      [],
    );
    expect(await db.select().from(content).where(eq(content.worldId, worldId))).toEqual([]);
    expect(await db.select().from(actors).where(eq(actors.worldId, worldId))).toEqual([]);
    expect(
      await db.select().from(feedImpressions).where(eq(feedImpressions.worldId, worldId)),
    ).toEqual([]);
    expect(await db.select().from(worlds).where(eq(worlds.id, worldId))).toEqual([]);

    const [record] = await db
      .select()
      .from(dataDeletions)
      .where(eq(dataDeletions.participantId, id));
    expect(record).toMatchObject({
      reason: "withdrew",
      requestedBy: "researcher",
      eventsDeleted: 1,
    });
  });

  it("leaves other participants and the study itself alone", async () => {
    const setup = await createVersion({ frozen: true });
    const leaving = await enroll(setup, "leaving");
    const staying = await enroll(setup, "staying");
    await like(setup, leaving);
    await like(setup, staying);

    await deleteData(leaving.participant.id);

    expect(
      await db.select().from(events).where(eq(events.participantId, staying.participant.id)),
    ).toHaveLength(1);
    expect(await db.select().from(content).where(eq(content.id, setup.post.id))).toHaveLength(1);
  });

  it("turns the protection back on afterward", async () => {
    const setup = await createVersion();
    const leaving = await enroll(setup, "leaving");
    const staying = await enroll(setup, "staying");
    await like(setup, staying);

    const failure = await failureOf(() =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`select delete_participant_data(${leaving.participant.id}, 'withdrew', 'researcher')`,
        );
        await tx.delete(events);
      }),
    );
    expect(failure).toContain("append-only");
  });

  it("in a shared world, takes what was theirs, and wipes what they wrote, leaving the others'", async () => {
    const setup = await createVersion();
    const leaving = await enroll(setup, "P1", "shared");
    // Someone else in the same world.
    const [other] = await db
      .insert(participants)
      .values({ studyId: setup.study.id, externalId: "P2", source: "test" })
      .returning();
    const [otherActor] = await db
      .insert(actors)
      .values({
        studyVersionId: setup.version.id,
        worldId: leaving.world.id,
        participantId: other!.id,
        username: "me-P2",
        driver: "human",
      })
      .returning();
    await db
      .insert(worldMemberships)
      .values({ worldId: leaving.world.id, participantId: other!.id, actorId: otherActor!.id });

    const [post] = await db
      .insert(content)
      .values({
        studyVersionId: setup.version.id,
        worldId: leaving.world.id,
        authorActorId: leaving.actor.id,
        kind: "post",
        body: "Something I wrote",
        visibleAt: new Date(),
      })
      .returning();
    const [reply] = await db
      .insert(content)
      .values({
        studyVersionId: setup.version.id,
        worldId: leaving.world.id,
        authorActorId: otherActor!.id,
        kind: "comment",
        parentId: post!.id,
        body: "My reply",
        visibleAt: new Date(),
      })
      .returning();
    // The other person liked it, which their record keeps.
    await recordEvent(db, {
      type: "content.liked",
      payload: {},
      worldId: leaving.world.id,
      studyVersionId: setup.version.id,
      participantId: other!.id,
      conditionId: setup.conditionA.id,
      actorId: otherActor!.id,
      targetContentId: post!.id,
      source: "participant",
      occurredAt: new Date(),
    });

    await deleteData(leaving.participant.id);

    expect(
      await db.select().from(participants).where(eq(participants.id, leaving.participant.id)),
    ).toHaveLength(0);
    const [wiped] = await db.select().from(content).where(eq(content.id, post!.id));
    expect(wiped).toMatchObject({ body: "", withdrawnAt: expect.any(Date) });
    const [kept] = await db.select().from(content).where(eq(content.id, reply!.id));
    expect(kept).toMatchObject({ body: "My reply", withdrawnAt: null });
    expect(await db.select().from(events).where(eq(events.participantId, other!.id))).toHaveLength(
      1,
    );
    expect(await db.select().from(worlds).where(eq(worlds.id, leaving.world.id))).toHaveLength(1);
    const [actor] = await db.select().from(actors).where(eq(actors.id, leaving.actor.id));
    expect(actor).toMatchObject({
      driver: "withdrawn",
      participantId: null,
      profile: { name: "Withdrawn" },
    });

    // When the last one leaves too, the world goes entirely, with what anyone wrote in it.
    await deleteData(other!.id);
    expect(await db.select().from(worlds).where(eq(worlds.id, leaving.world.id))).toHaveLength(0);
    expect(
      await db.select().from(content).where(eq(content.worldId, leaving.world.id)),
    ).toHaveLength(0);
    expect(await db.select().from(actors).where(eq(actors.worldId, leaving.world.id))).toHaveLength(
      0,
    );
    expect(await db.select().from(events).where(eq(events.worldId, leaving.world.id))).toHaveLength(
      0,
    );
  });
});
