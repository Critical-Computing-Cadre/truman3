import { randomBytes } from "node:crypto";
import { type Database, schema } from "@truman3/db";
import { and, eq, gt } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { hashSessionToken } from "../participants/session.ts";

/** Separate from the participant cookie, so a researcher can also try their own study. */
export const RESEARCHER_COOKIE = "researcher_session";

export const RESEARCHER_SESSION_DAYS = 14;

export async function createResearcherSession(db: Database, researcherId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESEARCHER_SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db
    .insert(schema.researcherSessions)
    .values({ tokenHash: hashSessionToken(token), researcherId, expiresAt });
  return { token, expiresAt };
}

/** The signed-in researcher for a request, or null. */
export async function researcherFromRequest(c: Context, db: Database) {
  const token = getCookie(c, RESEARCHER_COOKIE);
  if (!token) {
    return null;
  }
  const [row] = await db
    .select({
      id: schema.researchers.id,
      email: schema.researchers.email,
      name: schema.researchers.name,
    })
    .from(schema.researcherSessions)
    .innerJoin(
      schema.researchers,
      eq(schema.researchers.id, schema.researcherSessions.researcherId),
    )
    .where(
      and(
        eq(schema.researcherSessions.tokenHash, hashSessionToken(token)),
        gt(schema.researcherSessions.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}
