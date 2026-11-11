import type { Conversation, Message } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { and, asc, eq, inArray, isNotNull, lte, max, or } from "drizzle-orm";
import { pictureUrlOf } from "../feed/build.ts";
import type { ParticipantContext } from "../participants/session.ts";

/**
 * Direct messages between the participant and the cast. A message is content of kind "message",
 * always in the participant's world, with who it's to. Someone in the cast only ever writes one
 * because a beat says so. See ADR 61.
 */

interface Profile {
  name?: string;
  picture?: string;
  conditionPictures?: Record<string, string>;
}

type Actor = typeof schema.actors.$inferSelect;

export function personOf(actor: Actor, conditionKey: string, mediaPublicUrl: string) {
  const profile = (actor.profile ?? {}) as Profile;
  return {
    username: actor.username,
    name: profile.name ?? actor.username,
    pictureUrl: pictureUrlOf(profile, conditionKey, mediaPublicUrl),
  };
}

/** Every message to or from the participant that has appeared by now, oldest first. */
async function theirMessages(db: Database, context: ParticipantContext, now: Date) {
  return db
    .select()
    .from(schema.content)
    .where(
      and(
        eq(schema.content.worldId, context.worldId),
        eq(schema.content.kind, "message"),
        lte(schema.content.visibleAt, now),
        or(
          eq(schema.content.authorActorId, context.actorId),
          eq(schema.content.recipientActorId, context.actorId),
        ),
      ),
    )
    .orderBy(asc(schema.content.visibleAt), asc(schema.content.createdAt));
}

function toMessage(context: ParticipantContext, row: typeof schema.content.$inferSelect): Message {
  return {
    id: row.id,
    body: row.body,
    at: (row.visibleAt as Date).toISOString(),
    mine: row.authorActorId === context.actorId,
  };
}

/** When the participant last opened each conversation, by who it's with. */
async function lastOpened(db: Database, context: ParticipantContext) {
  const rows = await db
    .select({ with: schema.events.targetActorId, at: max(schema.events.occurredAt) })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.worldId, context.worldId),
        eq(schema.events.type, "messages.opened"),
        isNotNull(schema.events.targetActorId),
      ),
    )
    .groupBy(schema.events.targetActorId);
  return new Map(rows.map((row) => [row.with as string, row.at as Date]));
}

/** The Messages page: each conversation, newest first, with how many messages are new. */
export async function listConversations(
  db: Database,
  context: ParticipantContext,
  mediaPublicUrl: string,
  now: Date,
): Promise<Conversation[]> {
  const messages = await theirMessages(db, context, now);
  const otherOf = (row: (typeof messages)[number]) =>
    (row.authorActorId === context.actorId ? row.recipientActorId : row.authorActorId) as string;
  const others = [...new Set(messages.map(otherOf))];
  if (others.length === 0) {
    return [];
  }
  const actors = new Map(
    (await db.select().from(schema.actors).where(inArray(schema.actors.id, others))).map(
      (actor) => [actor.id, actor],
    ),
  );
  const opened = await lastOpened(db, context);
  return others
    .flatMap((otherId) => {
      const actor = actors.get(otherId);
      const withThem = messages.filter((row) => otherOf(row) === otherId);
      const last = withThem.at(-1);
      if (!actor || !last) {
        return [];
      }
      const since = opened.get(otherId);
      const unread = withThem.filter(
        (row) =>
          row.authorActorId === otherId &&
          (!since || (row.visibleAt as Date).getTime() > since.getTime()),
      ).length;
      return [
        {
          with: personOf(actor, context.conditionKey, mediaPublicUrl),
          last: toMessage(context, last),
          unread,
        },
      ];
    })
    .sort((a, b) => b.last.at.localeCompare(a.last.at));
}

/** The participant's conversation with one person in the cast, oldest first. */
export async function conversationWith(
  db: Database,
  context: ParticipantContext,
  otherId: string,
  now: Date,
): Promise<Message[]> {
  return (await theirMessages(db, context, now))
    .filter((row) => row.authorActorId === otherId || row.recipientActorId === otherId)
    .map((row) => toMessage(context, row));
}

/** How many messages they haven't read yet, across every conversation, for a badge. */
export async function unreadMessages(
  db: Database,
  context: ParticipantContext,
  mediaPublicUrl: string,
  now: Date,
) {
  return (await listConversations(db, context, mediaPublicUrl, now)).reduce(
    (total, conversation) => total + conversation.unread,
    0,
  );
}
