import { z } from "zod";

const LOCAL_PARTICIPANT_APP = "http://localhost:5180";
const LOCAL_ADMIN_APP = "http://localhost:5181/admin/";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  MEDIA_PUBLIC_URL: z.url(),
  NODE_ENV: z.string().optional(),
  /** How many proxies of ours add to X-Forwarded-For. See client-address.ts. */
  TRUSTED_PROXIES: z.coerce.number().int().nonnegative().default(0),
  LOGIN_ATTEMPTS_PER_MINUTE: z.coerce.number().int().positive().default(10),
  /** Encrypts Prolific tokens and labs' own Claude keys. Without it, both are turned off. */
  TRUMAN_SECRET_KEY: z.string().optional(),
  PROLIFIC_API_URL: z.url().optional(),
  /** Lets Christof's actors write live with Claude. Without it, beats use their fallback lines. */
  ANTHROPIC_API_KEY: z.string().optional(),
  /** The participant app's public address, used in study links and the link Prolific sends people to. */
  PARTICIPANT_APP_URL: z.url().optional(),
  /**
   * The address email to researchers comes from, such as "Truman <no-reply@example.org>", on a
   * domain verified in Amazon SES. Without it, email is printed in development and not sent
   * otherwise. ADR 72.
   */
  MAIL_FROM: z.string().optional(),
  /** The AWS region SES sends from. */
  MAIL_REGION: z.string().default("us-east-1"),
  /** For browser tests only: email is written to this file instead of being sent. */
  TEST_MAIL_OUTBOX: z.string().optional(),
  /** The admin app's public address, for links in email. Defaults to beside the participant app. */
  ADMIN_APP_URL: z.url().optional(),
  /** "true" makes this a hosted Truman: labs apply, and an operator approves them. ADR 70. */
  HOSTED: z.enum(["true", "false"]).default("false"),
});

/** Reads the server's settings. Throws rather than start with a setting that can't work. */
export function parseServerEnv(env: NodeJS.ProcessEnv) {
  const parsed = envSchema.parse(env);
  if (env.NODE_ENV === "production" && !parsed.PARTICIPANT_APP_URL) {
    // The local default would put a localhost link in front of researchers and participants.
    throw new Error("PARTICIPANT_APP_URL isn't set. See docs/guides/deploying.md.");
  }
  return {
    ...parsed,
    PARTICIPANT_APP_URL: parsed.PARTICIPANT_APP_URL ?? LOCAL_PARTICIPANT_APP,
    ADMIN_APP_URL:
      parsed.ADMIN_APP_URL ??
      // Locally the admin app has its own port. Deployed, it's under /admin/ at the same address.
      (parsed.PARTICIPANT_APP_URL && env.NODE_ENV !== "development"
        ? new URL("/admin/", parsed.PARTICIPANT_APP_URL).toString()
        : LOCAL_ADMIN_APP),
    HOSTED: parsed.HOSTED === "true",
  };
}
