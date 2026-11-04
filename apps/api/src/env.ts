import { z } from "zod";

const LOCAL_PARTICIPANT_APP = "http://localhost:5180";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  MEDIA_PUBLIC_URL: z.url(),
  NODE_ENV: z.string().optional(),
  /** How many proxies of ours add to X-Forwarded-For. See client-address.ts. */
  TRUSTED_PROXIES: z.coerce.number().int().nonnegative().default(0),
  LOGIN_ATTEMPTS_PER_MINUTE: z.coerce.number().int().positive().default(10),
  /** Encrypts researchers' Prolific tokens. Without it, connecting to Prolific is turned off. */
  TRUMAN_SECRET_KEY: z.string().optional(),
  PROLIFIC_API_URL: z.url().optional(),
  /** The participant app's public address, used in study links and the link Prolific sends people to. */
  PARTICIPANT_APP_URL: z.url().optional(),
});

/** Reads the server's settings. Throws rather than start with a setting that can't work. */
export function parseServerEnv(env: NodeJS.ProcessEnv) {
  const parsed = envSchema.parse(env);
  if (env.NODE_ENV === "production" && !parsed.PARTICIPANT_APP_URL) {
    // The local default would put a localhost link in front of researchers and participants.
    throw new Error("PARTICIPANT_APP_URL isn't set. See docs/guides/deploying.md.");
  }
  return { ...parsed, PARTICIPANT_APP_URL: parsed.PARTICIPANT_APP_URL ?? LOCAL_PARTICIPANT_APP };
}
