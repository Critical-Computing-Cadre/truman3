import { createTestDatabase } from "@truman3/db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeError } from "./errors.ts";

const RECRUITMENT_ID = "PROLIFIC-ID-123";

describe("describeError, with an error from a real database", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it("leaves out the value, which Drizzle and Postgres both put in their messages", async () => {
    const error = await database.db
      .execute(sql`select ${RECRUITMENT_ID}::int`)
      .catch((caught: unknown) => caught);

    // If this stops being true, the test no longer shows anything.
    expect((error as Error).message + (error as Error).cause).toContain(RECRUITMENT_ID);

    const described = describeError(error);
    expect(described.cause).toMatchObject({ name: "PostgresError", code: "22P02" });
    expect(JSON.stringify(described)).not.toContain(RECRUITMENT_ID);
  });
});
