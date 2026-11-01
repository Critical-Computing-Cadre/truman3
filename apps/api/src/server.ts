import { serve } from "@hono/node-server";
import { createDb } from "@truman3/db";
import { z } from "zod";
import { createApp } from "./app.ts";

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().positive().default(3000),
  })
  .parse(process.env);

const database = createDb(env.DATABASE_URL);
const app = createApp({ pingDatabase: database.ping });

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
