import { randomBytes } from "node:crypto";
import { type Database, schema } from "@truman3/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { hashSessionToken } from "../participants/session.ts";

/** Separate from the participant cookie, so a researcher can also try their own study. */
export const RESEARCHER_COOKIE = "researcher_session";

export const RESEARCHER_SESSION_DAYS = 14;

/** What a personal access token starts with, so one is easy to recognize, and to scan for. */
export const TOKEN_PREFIX = "truman_pat_";

export async function createResearcherSession(db: Database, researcherId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESEARCHER_SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db
    .insert(schema.researcherSessions)
    .values({ tokenHash: hashSessionToken(token), researcherId, expiresAt });
  return { token, expiresAt };
}

/** The personal access token a request carries, if it uses one rather than the admin app's cookie. */
export function bearerToken(c: Context): string | null {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? (match[1] as string) : null;
}

export interface Researcher {
  id: string;
  email: string;
  name: string;
  /** Set when an agent is acting for them with a personal access token. ADR 64. */
  token?: { id: string; name: string };
}

/** The signed-in researcher for a request, from their cookie or a personal access token, or null. */
export async function researcherFromRequest(c: Context, db: Database): Promise<Researcher | null> {
  const bearer = bearerToken(c);
  if (bearer) {
    const [row] = await db
      .select({
        id: schema.researchers.id,
        email: schema.researchers.email,
        name: schema.researchers.name,
        tokenId: schema.researcherTokens.id,
        tokenName: schema.researcherTokens.name,
      })
      .from(schema.researcherTokens)
      .innerJoin(
        schema.researchers,
        eq(schema.researchers.id, schema.researcherTokens.researcherId),
      )
      .where(
        and(
          eq(schema.researcherTokens.tokenHash, hashSessionToken(bearer)),
          gt(schema.researcherTokens.expiresAt, new Date()),
          isNull(schema.researcherTokens.revokedAt),
        ),
      );
    if (!row) {
      return null;
    }
    await db
      .update(schema.researcherTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.researcherTokens.id, row.tokenId));
    const { tokenId, tokenName, ...researcher } = row;
    return { ...researcher, token: { id: tokenId, name: tokenName } };
  }
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
