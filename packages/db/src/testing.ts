import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { applyAppRole, DEFAULT_APP_ROLE } from "./app-role.ts";
import { createDb } from "./client.ts";
import { runMigrations } from "./migrate.ts";

/** Only for local and CI databases, which nothing outside the machine can reach. */
const TEST_APP_PASSWORD = "truman_app_test_only";
const ROLE_LOCK = 7_210_021;

/**
 * Creates an empty, migrated database for one test file, so tests can't affect each other or
 * your development data. Needs DATABASE_URL to point at a running Postgres.
 *
 * It connects the way production does: migrated by the owner, then used through the API's login, so
 * something that only works as the owner fails here. `db` is that login, and `ownerDb` is there for
 * testing what the owner can do. Tests of the database's own rules can ask to be the owner.
 */
export async function createTestDatabase({ asOwner = false }: { asOwner?: boolean } = {}) {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error("Integration tests need DATABASE_URL. Copy .env.example to .env.");
  }

  const name = `truman_test_${randomBytes(6).toString("hex")}`;
  const admin = postgres(baseUrl, { onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);

  const ownerUrl = new URL(baseUrl);
  ownerUrl.pathname = `/${name}`;
  const owner = createDb(ownerUrl.toString());
  await runMigrations(owner.db);

  // A login belongs to the whole server, and test files start together. The lock is on the base
  // database because that's the one they share.
  await admin.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${ROLE_LOCK})`;
    await applyAppRole(owner.db, { password: TEST_APP_PASSWORD });
  });

  const appUrl = new URL(ownerUrl);
  appUrl.username = DEFAULT_APP_ROLE;
  appUrl.password = TEST_APP_PASSWORD;
  const url = (asOwner ? ownerUrl : appUrl).toString();
  const database = asOwner ? owner : createDb(url);

  return {
    ...database,
    ownerDb: owner.db,
    url,
    destroy: async () => {
      if (!asOwner) {
        await database.close();
      }
      await owner.close();
      await admin.unsafe(`drop database ${name}`);
      await admin.end();
    },
  };
}
