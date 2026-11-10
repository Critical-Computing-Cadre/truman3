import { type Database, schema } from "@truman3/db";
import type { Storage } from "@truman3/storage";
import type { Writer } from "@truman3/writer";
import { desc, eq } from "drizzle-orm";
import { createApp } from "../app.ts";
import { startPilot } from "../participants/enter.ts";
import { hashSessionToken } from "../participants/session.ts";

/**
 * What scenario tests and simulated participants share: the API, on a clock they move forward,
 * and test participants who use it the way a real participant's browser does. See ADR 56.
 */

export interface Response {
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
}

export interface TestParticipant {
  participantId: string;
  worldId: string;
  /** Sends a request as them. */
  send: (method: string, url: string, body?: object | FormData) => Promise<Response>;
  /** The condition they're in now, which a decision point can change. */
  condition: () => Promise<string | undefined>;
}

export interface Harness {
  /** The time the API sees. */
  now: () => Date;
  setNow: (date: Date) => void;
  /**
   * Starts a test participant in a condition, at the current time, or null if it can't. A world
   * seed makes what's drawn at random in their world, like delays, the same each time.
   */
  start: (condition: string, worldSeed?: number) => Promise<TestParticipant | null>;
}

export function createHarness({
  db,
  storage,
  versionId,
  writer = null,
}: {
  db: Database;
  storage: Storage;
  versionId: string;
  writer?: Writer | null;
}): Harness {
  let now = new Date();
  const app = createApp({
    pingDatabase: async () => {},
    db,
    storage,
    mediaPublicUrl: "http://media.invalid",
    getClientIp: () => undefined,
    secureCookies: false,
    writer,
    clock: () => now,
  });
  const request = async (
    method: string,
    url: string,
    cookie: string,
    body?: object | FormData,
  ): Promise<Response & { cookie: string }> => {
    const response = await app.request(url, {
      method,
      headers: {
        cookie,
        ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: response.ok,
      status: response.status,
      json,
      cookie: response.headers.get("set-cookie") ?? "",
    };
  };

  return {
    now: () => now,
    setNow: (date) => {
      now = date;
    },
    start: async (condition, worldSeed) => {
      const started = await startPilot(db, versionId, condition, now, worldSeed);
      if (!started?.token) {
        return null;
      }
      const signedIn = await request("POST", "/pilot-session", "", { token: started.token });
      const cookie = signedIn.cookie.split(";")[0] ?? "";
      const [session] = await db
        .select({
          participantId: schema.sessions.participantId,
          worldId: schema.worldMemberships.worldId,
        })
        .from(schema.sessions)
        .innerJoin(
          schema.worldMemberships,
          eq(schema.worldMemberships.participantId, schema.sessions.participantId),
        )
        .where(eq(schema.sessions.tokenHash, hashSessionToken(started.token)));
      if (!session) {
        return null;
      }
      const { participantId, worldId } = session;
      return {
        participantId,
        worldId,
        send: (method, url, body) => request(method, url, cookie, body),
        condition: async () => {
          const [assignment] = await db
            .select({ key: schema.conditions.key })
            .from(schema.assignments)
            .innerJoin(schema.conditions, eq(schema.conditions.id, schema.assignments.conditionId))
            .where(eq(schema.assignments.participantId, participantId))
            .orderBy(desc(schema.assignments.id))
            .limit(1);
          return assignment?.key;
        },
      };
    },
  };
}

/** Every post and comment's text in a feed, however deeply comments are nested. */
export function bodiesIn(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(bodiesIn);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      ...(typeof record.body === "string" ? [record.body] : []),
      ...Object.values(record).flatMap(bodiesIn),
    ];
  }
  return [];
}
