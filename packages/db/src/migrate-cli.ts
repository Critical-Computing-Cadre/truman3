import { createDb } from "./client.ts";
import { runMigrations } from "./migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL isn't set. Copy .env.example to .env.");
}

const database = createDb(url);
await runMigrations(database.db);
await database.close();
console.log("Database is up to date.");
