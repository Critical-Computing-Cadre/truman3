import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { createDb } from "./client.ts";
import { runMigrations } from "./migrate.ts";

/**
 * Creates an empty, migrated database for one test file, so tests can't affect each other or
 * your development data. Needs DATABASE_URL to point at a running Postgres.
 */
export async function createTestDatabase() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error("Integration tests need DATABASE_URL. Copy .env.example to .env.");
  }

  const name = `truman_test_${randomBytes(6).toString("hex")}`;
  const admin = postgres(baseUrl, { onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);

  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  const database = createDb(url.toString());
  await runMigrations(database.db);

  return {
    ...database,
    url: url.toString(),
    destroy: async () => {
      await database.close();
      await admin.unsafe(`drop database ${name}`);
      await admin.end();
    },
  };
}
