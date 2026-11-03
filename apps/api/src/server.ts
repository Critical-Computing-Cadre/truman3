import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createDb } from "@truman3/db";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { createApp } from "./app.ts";
import { parseServerEnv } from "./env.ts";
import { describeError } from "./errors.ts";
import { createRateLimiter } from "./rate-limit.ts";

const env = parseServerEnv(process.env);
const logFullErrors = env.NODE_ENV === "development";

const database = createDb(env.DATABASE_URL);
const storage = createStorage(storageConfigFromEnv());
await storage.ensureBucket();
/** Generous, since many participants can share one address on a campus network. */
const ENTRY_ATTEMPTS_PER_MINUTE = 120;

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
  prolific: {
    secretKey: env.TRUMAN_SECRET_KEY,
    apiUrl: env.PROLIFIC_API_URL,
    participantAppUrl: env.PARTICIPANT_APP_URL,
  },
  getClientIp: (c) => {
    const forwarded = env.TRUST_PROXY
      ? c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
      : undefined;
    return forwarded ?? getConnInfo(c).remote.address;
  },
});

const server = serve({ fetch: app.fetch, port: env.PORT }, ({ port }) => {
  console.log(`API listening on http://localhost:${port}`);
});

function shutdown() {
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
