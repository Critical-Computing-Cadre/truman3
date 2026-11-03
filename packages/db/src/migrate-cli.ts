import { applyAppRole, DEFAULT_APP_ROLE } from "./app-role.ts";
import { createDb } from "./client.ts";
import { runMigrations } from "./migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL isn't set. Copy .env.example to .env.");
}

const role = process.env.DATABASE_APP_ROLE ?? DEFAULT_APP_ROLE;
const database = createDb(url);
await runMigrations(database.db);
const updated = await applyAppRole(database.db, {
  role,
  password: process.env.DATABASE_APP_PASSWORD,
});
await database.close();
console.log("Database is up to date.");
console.log(
  updated ? `Set out what the login ${role} can do.` : `There's no login ${role}, so skipped it.`,
);
