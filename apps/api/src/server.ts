import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createDb } from "@truman3/db";
import { z } from "zod";
import { createApp } from "./app.ts";

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(3000),
    MEDIA_PUBLIC_URL: z.url(),
    NODE_ENV: z.string().optional(),
    /** Only set this behind a load balancer, or anyone could fake their address. */
    TRUST_PROXY: z.stringbool().default(false),
  })
  .parse(process.env);

const database = createDb(env.DATABASE_URL);
const app = createApp({
  pingDatabase: database.ping,
  db: database.db,
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
    await database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
