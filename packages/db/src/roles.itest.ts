import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAppRole, connectedAsOwner } from "./app-role.ts";
import { dataDeletions, participants, studies } from "./schema.ts";
import { createTestDatabase } from "./testing.ts";

let database: Awaited<ReturnType<typeof createTestDatabase>>;

async function failureOf(action: () => PromiseLike<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    const { message, cause } = error as Error & { cause?: Error };
    return cause?.message ?? message;
  }
  throw new Error("Expected this to fail, but it succeeded.");
}

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.destroy();
});

describe("the API's login", () => {
  it("can do its everyday work", async () => {
    const [study] = await database.db
      .insert(studies)
      .values({ slug: "everyday" })
      .returning({ id: studies.id });
    await database.db.update(studies).set({ slug: "changed" }).where(eq(studies.id, study!.id));
    await database.db.delete(studies).where(eq(studies.id, study!.id));
  });

  it("isn't taken for an owner, while the owner is", async () => {
    expect(await connectedAsOwner(database.db)).toBe(false);
    expect(await connectedAsOwner(database.ownerDb)).toBe(true);
  });

  it.each([
    ["creating a table", "create table sneaky (id int)"],
    ["creating a function", "create function sneaky() returns int language sql as 'select 1'"],
    ["dropping a table", "drop table participants"],
    ["changing a table", "alter table participants add column sneaky int"],
    ["turning off a rule", "alter table events disable trigger all"],
    [
      "replacing a rule's function",
      "create or replace function forbid_change() returns trigger language plpgsql as 'begin return old; end'",
    ],
    ["emptying a table", "truncate participants cascade"],
    ["emptying events", "truncate events"],
    ["turning off all triggers", "set session_replication_role = replica"],
    ["reading the migration history", "select * from drizzle.__drizzle_migrations"],
  ])("is refused %s", async (_name, statement) => {
    expect(await failureOf(() => database.db.execute(sql.raw(statement)))).toMatch(
      /permission denied|must be owner/,
    );
  });

  it.each([
    ["events", "type"],
    ["assignments", "participant_id"],
  ])("can read and add to %s, but not change them", async (table, column) => {
    await database.db.execute(sql.raw(`select count(*) from ${table}`));
    for (const change of [`update ${table} set ${column} = ${column}`, `delete from ${table}`]) {
      expect(await failureOf(() => database.db.execute(sql.raw(change)))).toContain(
        "permission denied",
      );
    }
  });

  it("can't get around that by turning on the setting withdrawal uses", async () => {
    const message = await failureOf(() =>
      database.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('truman.allow_participant_deletion', 'on', true)`);
        await tx.execute(sql`delete from events`);
      }),
    );
    expect(message).toContain("permission denied");
  });

  it("can still withdraw someone, which records the deletion", async () => {
    const [study] = await database.db
      .insert(studies)
      .values({ slug: "withdrawing" })
      .returning({ id: studies.id });
    const [person] = await database.db
      .insert(participants)
      .values({ studyId: study!.id, externalId: "leaving", source: "test" })
      .returning({ id: participants.id });

    await database.db.execute(
      sql`select delete_participant_data(${person!.id}, 'withdrew', 'researcher')`,
    );

    expect(
      await database.db.select().from(dataDeletions).where(eq(dataDeletions.studyId, study!.id)),
    ).toHaveLength(1);
    expect(
      await database.db.select().from(participants).where(eq(participants.id, person!.id)),
    ).toHaveLength(0);
  });

  it("covers a table added by a later migration, once the update runs again", async () => {
    await database.ownerDb.execute(sql`create table added_later (id int)`);
    expect(await failureOf(() => database.db.execute(sql`select * from added_later`))).toContain(
      "permission denied",
    );

    expect(await applyAppRole(database.ownerDb)).toBe(true);

    await database.db.execute(sql`insert into added_later values (1)`);
    await database.ownerDb.execute(sql`drop table added_later`);
  });

  it("is left alone when there's no such login and no password", async () => {
    expect(await applyAppRole(database.ownerDb, { role: "nobody_here" })).toBe(false);
  });
});
