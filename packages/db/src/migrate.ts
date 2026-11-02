import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Database } from "./client.ts";

const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "../migrations");

/** Brings a database up to date. Each migration runs once, in order. */
export async function runMigrations(db: Database) {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
