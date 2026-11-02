import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createDb } from "@truman3/db";
import { createStorage, storageConfigFromEnv } from "@truman3/storage";
import { z } from "zod";
import { createApp } from "./app.ts";
import { createRateLimiter } from "./rate-limit.ts";

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(3000),
    MEDIA_PUBLIC_URL: z.url(),
    NODE_ENV: z.string().optional(),
    /** Only set this behind a load balancer, or anyone could fake their address. */
    TRUST_PROXY: z.stringbool().default(false),
    LOGIN_ATTEMPTS_PER_MINUTE: z.coerce.number().int().positive().default(10),
  })
  .parse(process.env);

const database = createDb(env.DATABASE_URL);
const storage = createStorage(storageConfigFromEnv());
await storage.ensureBucket();
/** Generous, since many participants can share one address on a campus network. */
const ENTRY_ATTEMPTS_PER_MINUTE = 120;

const app = createApp({
  allowEntryAttempt: createRateLimiter({ max: ENTRY_ATTEMPTS_PER_MINUTE, windowMs: 60_000 }),
  allowLoginAttempt: createRateLimiter({ max: env.LOGIN_ATTEMPTS_PER_MINUTE, windowMs: 60_000 }),
  pingDatabase: database.ping,
  db: database.db,
  storage,
  mediaPublicUrl: env.MEDIA_PUBLIC_URL,
  secureCookies: env.NODE_ENV !== "development",
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

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
