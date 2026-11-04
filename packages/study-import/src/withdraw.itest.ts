import { randomUUID } from "node:crypto";
import { schema } from "@truman3/db";
import { createTestDatabase } from "@truman3/db/testing";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withdrawParticipant } from "./withdraw.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
const storage = createStorage(storageConfigFromEnv());

async function setUp(slug: string, externalId: string) {
  const { db } = database;
  const [study] = await db.insert(schema.studies).values({ slug }).returning();
  const [version] = await db
    .insert(schema.studyVersions)
    .values({ studyId: study!.id, version: 1, settings: {}, contentHash: slug, seed: 1 })
    .returning();
  const [participant] = await db
    .insert(schema.participants)
    .values({ studyId: study!.id, externalId, source: "test" })
    .returning();
  const [world] = await db
    .insert(schema.worlds)
    .values({ studyVersionId: version!.id, seed: 1 })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({
      studyVersionId: version!.id,
      worldId: world!.id,
      participantId: participant!.id,
      username: "me",
      driver: "human",
    })
    .returning();
  await db
    .insert(schema.worldMemberships)
    .values({ worldId: world!.id, participantId: participant!.id, actorId: actor!.id });
  return { participant: participant!, world: world! };
}

beforeAll(async () => {
  database = await createTestDatabase();
  await storage.ensureBucket();
});

afterAll(async () => {
  storage.close();
  await database.destroy();
});

describe("withdrawParticipant", () => {
  it("deletes their uploaded files, leaving those of others in the same world", async () => {
    const slug = `w-${randomUUID().slice(0, 8)}`;
    const { participant, world } = await setUp(slug, "leaving");
    const mine = `uploads/${world.id}/${participant.id}/photo.jpg`;
    const sameWorld = `uploads/${world.id}/${randomUUID()}/photo.jpg`;
    await storage.put(mine, new Uint8Array([1]), "image/jpeg");
    await storage.put(sameWorld, new Uint8Array([2]), "image/jpeg");

    const result = await withdrawParticipant(database.db, storage, {
      slug,
      externalId: "leaving",
      reason: "withdrew",
      requestedBy: "tester",
    });

    expect(result).toMatchObject({ status: "withdrawn", filesDeleted: 1 });
    expect(await storage.exists(mine)).toBe(false);
    expect(await storage.exists(sameWorld)).toBe(true);

    await storage.delete(sameWorld);
  });

  it("deletes their data and uploaded files, leaving other people's files alone", async () => {
    const slug = `w-${randomUUID().slice(0, 8)}`;
    const { participant, world } = await setUp(slug, "leaving");
    const mine = `uploads/${world.id}/${participant.id}/photo.jpg`;
    const someoneElse = `uploads/${randomUUID()}/photo.jpg`;
    await storage.put(mine, new Uint8Array([1]), "image/jpeg");
    await storage.put(someoneElse, new Uint8Array([2]), "image/jpeg");

    const result = await withdrawParticipant(database.db, storage, {
      slug,
      externalId: "leaving",
      reason: "withdrew",
      requestedBy: "tester",
    });

    expect(result).toMatchObject({ status: "withdrawn", filesDeleted: 1 });
    expect(await storage.exists(mine)).toBe(false);
    expect(await storage.exists(someoneElse)).toBe(true);
    expect(
      await database.db
        .select()
        .from(schema.participants)
        .where(eq(schema.participants.id, participant.id)),
    ).toEqual([]);

    await storage.delete(someoneElse);
  });

  it("changes nothing when there's no such participant", async () => {
    const slug = `w-${randomUUID().slice(0, 8)}`;
    await setUp(slug, "real");

    const result = await withdrawParticipant(database.db, storage, {
      slug,
      externalId: "typo",
      reason: "withdrew",
      requestedBy: "tester",
    });

    expect(result).toEqual({ status: "not-found" });
    expect(await database.db.select().from(schema.dataDeletions)).not.toContainEqual(
      expect.objectContaining({ requestedBy: "typo" }),
    );
  });
});
