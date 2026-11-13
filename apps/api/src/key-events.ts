import { timingSafeEqual } from "node:crypto";
import { type Database, schema } from "@truman3/db";
import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { Hono } from "hono";
import { emailOperators, emailOwners } from "./admin/accounts.ts";
import type { ParticipantRouteDependencies } from "./participants/routes.ts";

/**
 * Telling a lab when its own key is used by anyone but this server, or changed (ADR 83).
 *
 * AWS records every call to its key service. A rule on a hosted Truman sends the ones that matter
 * here: a lab's key used through the emergency role, and any change to a key or to who may use it.
 * Each is recorded, and the lab's owners are emailed.
 */

/** Reading something with the key. */
const USES = [
  "Decrypt",
  "Encrypt",
  "GenerateDataKey",
  "GenerateDataKeyWithoutPlaintext",
  "ReEncrypt",
];

/** Changing a key, or who may use it. The same list the rule on a hosted Truman sends. */
const CHANGES = [
  "PutKeyPolicy",
  "CreateGrant",
  "DisableKey",
  "ScheduleKeyDeletion",
  "DeleteImportedKeyMaterial",
];

/** One email covers what happens in the next while, so a restore isn't a hundred emails. */
const QUIET_MS = 60 * 60 * 1000;

/** What this needs of an event from AWS CloudTrail, as EventBridge delivers it. */
interface KeyServiceEvent {
  detail?: {
    eventID?: string;
    eventTime?: string;
    eventName?: string;
    /** Set when AWS refused the call, so nothing was read or changed. */
    errorCode?: string;
    userIdentity?: { arn?: string; sessionContext?: { sessionIssuer?: { arn?: string } } };
    resources?: { ARN?: string }[];
    requestParameters?: { keyId?: string } | null;
  };
}

const same = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Records one event, and emails the lab's owners unless they were emailed about this lab's key in
 * the last hour. Returns what it did. An event about a key that isn't a lab's is ignored.
 */
export async function recordKeyEvent(
  { db, mailer, ownRole }: Pick<ParticipantRouteDependencies, "db" | "mailer" | "ownRole">,
  event: KeyServiceEvent,
  now = new Date(),
): Promise<"ignored" | "recorded" | "recorded-and-told"> {
  const { detail } = event;
  if (!detail?.eventID || !detail.eventName) {
    return "ignored";
  }
  // A call AWS refused read nothing and changed nothing. And the emergency role's other calls,
  // such as asking what a key is, are neither a use nor a change.
  const kind = USES.includes(detail.eventName)
    ? "used"
    : CHANGES.includes(detail.eventName)
      ? "changed"
      : null;
  if (detail.errorCode || !kind) {
    return "ignored";
  }
  const by = detail.userIdentity?.sessionContext?.sessionIssuer?.arn ?? detail.userIdentity?.arn;
  // This server's own use is the ordinary running of the site.
  if (!by || (ownRole && by === ownRole)) {
    return "ignored";
  }
  const named = [
    ...(detail.resources ?? []).map(({ ARN }) => ARN),
    detail.requestParameters?.keyId,
  ].filter((value): value is string => Boolean(value));
  const teams = await db
    .select({ id: schema.teams.id, name: schema.teams.name, keyId: schema.teams.keyId })
    .from(schema.teams)
    .where(isNotNull(schema.teams.keyId));
  // A key is named by its whole ARN, or by the ID at the end of it.
  const team = teams.find(({ keyId }) =>
    named.some((name) => name === keyId || keyId?.endsWith(`/${name}`)),
  );
  if (!team) {
    return "ignored";
  }

  const at = detail.eventTime ? new Date(detail.eventTime) : now;
  const [told] = await db
    .select({ id: schema.keyEvents.id })
    .from(schema.keyEvents)
    .where(
      and(
        eq(schema.keyEvents.teamId, team.id),
        gt(schema.keyEvents.notifiedAt, new Date(now.getTime() - QUIET_MS)),
      ),
    )
    .limit(1);
  const [created] = await db
    .insert(schema.keyEvents)
    .values({
      teamId: team.id,
      eventId: detail.eventID,
      kind,
      action: detail.eventName,
      by,
      at,
      ...(told ? {} : { notifiedAt: now }),
    })
    .onConflictDoNothing()
    .returning({ id: schema.keyEvents.id });
  if (!created) {
    return "ignored";
  }
  if (told) {
    return "recorded";
  }

  const what =
    kind === "used"
      ? "was used to read your lab's data by someone other than the Truman server"
      : "was changed, or who may use it was";
  const text = [
    `The encryption key for your lab, ${team.name}, ${what}.`,
    "",
    `When: ${at.toISOString()}`,
    `What: ${detail.eventName}`,
    `Who: ${by}`,
    "",
    "This is the emergency access that whoever runs this Truman has, and it's recorded each time. If you didn't ask them for help with your data, ask them why.",
    "",
    "Anything more in the next hour is recorded and listed under Your lab, without another email.",
  ].join("\n");
  await emailOwners(
    db,
    mailer,
    team.id,
    `Your lab's encryption key ${kind === "used" ? "was used" : "was changed"}`,
    text,
  );
  await emailOperators(
    db,
    mailer,
    `A lab's key ${kind === "used" ? "was used" : "was changed"}: ${team.name}`,
    `${detail.eventName} by ${by} at ${at.toISOString()}. The lab's owners have been told.`,
  );
  return "recorded-and-told";
}

/** What a lab is shown about its key: whether it has one, and each time it was used or changed. */
export async function keyRecord(db: Database, teamId: string) {
  const [team] = await db
    .select({ keyId: schema.teams.keyId })
    .from(schema.teams)
    .where(eq(schema.teams.id, teamId));
  const events = await db
    .select({
      at: schema.keyEvents.at,
      kind: schema.keyEvents.kind,
      action: schema.keyEvents.action,
      by: schema.keyEvents.by,
    })
    .from(schema.keyEvents)
    .where(eq(schema.keyEvents.teamId, teamId))
    .orderBy(desc(schema.keyEvents.at))
    .limit(50);
  return {
    made: Boolean(team?.keyId),
    events: events.map((event) => ({
      ...event,
      kind: event.kind as "used" | "changed",
      at: event.at.toISOString(),
    })),
  };
}

/**
 * Where AWS sends those events. It's open to the internet, so it takes nothing without the key
 * this server and the rule share, and with no key set it isn't there at all.
 */
export function createKeyEventRoutes(dependencies: ParticipantRouteDependencies) {
  const app = new Hono();
  const { keyEventsHookKey } = dependencies;
  app.post("/hooks/key-events", async (c) => {
    const given = c.req.header("x-truman-hook-key") ?? "";
    if (!keyEventsHookKey || !same(given, keyEventsHookKey)) {
      return c.json({ error: "Not found." }, 404);
    }
    const event = (await c.req.json().catch(() => ({}))) as KeyServiceEvent;
    return c.json({ result: await recordKeyEvent(dependencies, event) }, 200);
  });
  return app;
}
