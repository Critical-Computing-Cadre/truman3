import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { connectedAsOwner, createDb } from "@truman3/db";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { anthropicWriter } from "@truman3/writer";
import { createApp } from "./app.ts";
import { forwardedAddress } from "./client-address.ts";
import { parseServerEnv } from "./env.ts";
import { describeError } from "./errors.ts";
import { expoPush, startPushing } from "./push.ts";
import { createRateLimiter } from "./rate-limit.ts";

const env = parseServerEnv(process.env);
const logFullErrors = env.NODE_ENV === "development";

const database = createDb(env.DATABASE_URL);
if (env.NODE_ENV === "production" && (await connectedAsOwner(database.db))) {
  // The rules that protect a study's data don't hold against the owner. See ADR 21.
  console.error(
    "DATABASE_URL logs in as a database owner. Use the login from the database update instead. See docs/guides/deploying.md.",
  );
  process.exit(1);
}
const storage = createStorage(storageConfigFromEnv());
await storage.ensureBucket();
/** Generous, since many participants can share one address on a campus network. */
const ENTRY_ATTEMPTS_PER_MINUTE = 120;

const writer = env.ANTHROPIC_API_KEY ? anthropicWriter(env.ANTHROPIC_API_KEY) : null;

const app = createApp({
  allowEntryAttempt: createRateLimiter({ max: ENTRY_ATTEMPTS_PER_MINUTE, windowMs: 60_000 }),
  allowLoginAttempt: createRateLimiter({ max: env.LOGIN_ATTEMPTS_PER_MINUTE, windowMs: 60_000 }),
  pingDatabase: database.ping,
  logFullErrors,
  db: database.db,
  storage,
  mediaPublicUrl: env.MEDIA_PUBLIC_URL,
  secureCookies: env.NODE_ENV !== "development",
  participantAppUrl: env.PARTICIPANT_APP_URL,
  writer,
  prolific: {
    secretKey: env.TRUMAN_SECRET_KEY,
    apiUrl: env.PROLIFIC_API_URL,
    participantAppUrl: env.PARTICIPANT_APP_URL,
  },
  getClientIp: (c) => {
    return (
      forwardedAddress(c.req.header("x-forwarded-for"), env.TRUSTED_PROXIES) ??
      getConnInfo(c).remote.address
    );
  },
});

// Push notifications for participants in the app (ADR 66). Only studies that turn push on use it.
const stopPushing = startPushing({ db: database.db, writer, send: expoPush });

const server = serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`API listening on http://localhost:${port}`);
});

function shutdown() {
  stopPushing();
  server.close(async () => {
    storage.close();
    await database.close();
    process.exit(0);
  });
}

// Node would print these in full, which can include what a query was given. See errors.ts.
if (!logFullErrors) {
  for (const event of ["uncaughtException", "unhandledRejection"] as const) {
    process.on(event, (error) => {
      console.error(`${event}:`, describeError(error));
      process.exit(1);
    });
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
