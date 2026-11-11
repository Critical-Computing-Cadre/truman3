import { featureOn } from "@truman3/core";
import { type Database, recordEvent, schema } from "@truman3/db";
import type { Writer } from "@truman3/writer";
import { and, eq, gt, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { mutedThreads, postsAbove, SHOWN_TO_PARTICIPANTS } from "./actions/notifications.ts";
import { catchUp } from "./director/director.ts";
import { loadWorldContext, type ParticipantContext } from "./participants/session.ts";

/**
 * Push notifications, for participants using the app (ADR 66). Nothing else in Truman runs between
 * a participant's visits: what's due is worked out when they next load something. Someone with the
 * app should hear about a reply while it's closed, so every so often this catches up the world of
 * each participant with push on, and sends what has newly come due: what their Notifications page
 * would show, and direct messages to them. Each is claimed before it's sent, so it's sent once.
 *
 * A push goes through Expo, Apple, and Google, so it says only who did what, like "Jake replied to
 * you", never what anyone wrote.
 */

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Where the app opens when it's tapped, and what kind it was, for the record. */
  data: { path: string; kind: "notification" | "message" };
}

/** Sends push messages, like Expo's push service does. Tests give their own. */
export type SendPush = (messages: PushMessage[]) => Promise<void>;

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo takes up to 100 at a time. */
const BATCH = 100;

/** Sends through Expo's push service, which passes them to Apple and Google. */
export const expoPush: SendPush = async (messages) => {
  for (let i = 0; i < messages.length; i += BATCH) {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(messages.slice(i, i + BATCH)),
    });
    if (!response.ok) {
      throw new Error(`Expo's push service answered ${response.status}.`);
    }
  }
};

/** What a push says for each kind of notification, without anything anyone wrote. */
const SAYS: Record<string, (name: string) => string> = {
  read: (name) => `${name} read your post`,
  like: (name) => `${name} liked your post`,
  reply: (name) => `${name} replied to you`,
  repost: (name) => `${name} reposted your post`,
  follow: (name) => `${name} followed you`,
  tag: (name) => `${name} tagged you in a post`,
  remove: (name) => `${name} removed your post`,
  warn: (name) => `${name} sent you a warning`,
  label: (name) => `${name} labeled your post`,
  answer: (name) => `${name} looked at your report`,
  ban: (name) => `${name} acted on your report`,
  approve: (name) => `${name} approved your post`,
  uphold: (name) => `${name} looked at your appeal`,
  restore: (name) => `${name} looked at your appeal`,
};

async function namesOf(db: Database, ids: string[]) {
  const rows = ids.length
    ? await db
        .select({
          id: schema.actors.id,
          username: schema.actors.username,
          profile: schema.actors.profile,
        })
        .from(schema.actors)
        .where(inArray(schema.actors.id, ids))
    : [];
  return new Map(
    rows.map(({ id, username, profile }) => [
      id,
      { username, name: (profile as { name?: string }).name ?? username },
    ]),
  );
}

/** What's newly due for one participant, claimed so it's sent only once. */
async function claimFor(db: Database, context: ParticipantContext, since: Date, now: Date) {
  const notifications = await db
    .update(schema.notifications)
    .set({ pushedAt: now })
    .where(
      and(
        eq(schema.notifications.worldId, context.worldId),
        eq(schema.notifications.recipientActorId, context.actorId),
        inArray(schema.notifications.type, SHOWN_TO_PARTICIPANTS),
        lte(schema.notifications.dueAt, now),
        gte(schema.notifications.dueAt, since),
        isNull(schema.notifications.pushedAt),
      ),
    )
    .returning();
  const messages = featureOn(context.settings, context.conditionKey, "messages")
    ? await db
        .update(schema.content)
        .set({ pushedAt: now })
        .where(
          and(
            eq(schema.content.worldId, context.worldId),
            eq(schema.content.kind, "message"),
            eq(schema.content.recipientActorId, context.actorId),
            lte(schema.content.visibleAt, now),
            gte(schema.content.visibleAt, since),
            isNull(schema.content.pushedAt),
          ),
        )
        .returning()
    : [];
  // A thread they muted doesn't notify them, here or on their Notifications page.
  const muted = await mutedThreads(db, context);
  if (muted.size === 0) {
    return { notifications, messages };
  }
  const above = await postsAbove(
    db,
    notifications.flatMap(({ targetContentId }) => (targetContentId ? [targetContentId] : [])),
  );
  return {
    notifications: notifications.filter(
      ({ targetContentId }) =>
        !targetContentId || !muted.has(above.get(targetContentId) ?? targetContentId),
    ),
    messages,
  };
}

/**
 * Catches up and sends what's newly due to everyone with push on. Returns how many were sent. A
 * failed send isn't tried again: a late push about something old would be stranger than none.
 */
export async function sendDuePushes({
  db,
  writer,
  send,
  now,
}: {
  db: Database;
  writer: Writer | null;
  send: SendPush;
  now: Date;
}): Promise<number> {
  const devices = await db
    .select({
      participantId: schema.sessions.participantId,
      token: schema.sessions.pushToken,
      since: schema.sessions.pushSince,
      worldId: schema.worldMemberships.worldId,
      actorId: schema.worldMemberships.actorId,
    })
    .from(schema.sessions)
    .innerJoin(
      schema.worldMemberships,
      and(
        eq(schema.worldMemberships.participantId, schema.sessions.participantId),
        isNull(schema.worldMemberships.leftAt),
      ),
    )
    .innerJoin(schema.participants, eq(schema.participants.id, schema.sessions.participantId))
    .where(
      and(
        isNotNull(schema.sessions.pushToken),
        gt(schema.sessions.expiresAt, now),
        eq(schema.participants.status, "active"),
      ),
    );

  let sent = 0;
  for (const device of devices) {
    const context = await loadWorldContext(db, device.worldId, device.actorId);
    if (!context || !featureOn(context.settings, context.conditionKey, "push")) {
      continue;
    }
    // What the cast does while the app is closed, as if they'd checked in.
    await catchUp(db, context, { writer, mayWrite: true, now });
    const { notifications, messages } = await claimFor(db, context, device.since as Date, now);
    if (notifications.length === 0 && messages.length === 0) {
      continue;
    }
    const names = await namesOf(db, [
      ...notifications.map(({ actorId }) => actorId),
      ...messages.map(({ authorActorId }) => authorActorId),
    ]);
    const title = context.settings.site.name;
    const pushes: PushMessage[] = [
      ...notifications.map((row) => ({
        to: device.token as string,
        title,
        body: (SAYS[row.type] ?? (() => "You have a new notification"))(
          names.get(row.actorId)?.name ?? "Someone",
        ),
        data: { path: "/notifications", kind: "notification" as const },
      })),
      ...messages.map((row) => {
        const from = names.get(row.authorActorId);
        return {
          to: device.token as string,
          title,
          body: `${from?.name ?? "Someone"} sent you a message`,
          data: { path: `/messages/${from?.username ?? ""}`, kind: "message" as const },
        };
      }),
    ];
    try {
      await send(pushes);
    } catch (error) {
      console.error(
        "Push notifications weren't sent:",
        error instanceof Error ? error.message : error,
      );
      continue;
    }
    for (const push of pushes) {
      await recordEvent(db, {
        type: "push.sent",
        payload: { kind: push.data.kind, about: push.body },
        worldId: context.worldId,
        studyVersionId: context.studyVersionId,
        participantId: context.participantId,
        conditionId: context.conditionId,
        actorId: context.actorId,
        source: "system",
        occurredAt: now,
      });
    }
    sent += pushes.length;
  }
  return sent;
}

/** Sends due push notifications every so often, for as long as the API runs. */
export function startPushing(
  options: Omit<Parameters<typeof sendDuePushes>[0], "now">,
  everyMs = 30_000,
) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) {
      return;
    }
    busy = true;
    try {
      await sendDuePushes({ ...options, now: new Date() });
    } catch (error) {
      console.error("Push notifications failed:", error instanceof Error ? error.message : error);
    } finally {
      busy = false;
    }
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
