import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

const CONNECT_TIMEOUT_SECONDS = 5;

/** Opens a connection pool to Postgres. Call `close` when shutting down. */
export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    onnotice: () => {},
  });
  const db = drizzle({ client, schema });

  return {
    db,
    /** Resolves if Postgres answers a query, and rejects if it doesn't. */
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    close: () => client.end(),
  };
}

export type Database = ReturnType<typeof createDb>["db"];

/** A transaction, which can do anything `Database` can except manage connections. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
