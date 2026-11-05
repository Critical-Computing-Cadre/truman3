import { featuresFor } from "@truman3/core";
import { type Database, recordEvent, schema, type Transaction } from "@truman3/db";
import { and, count, eq, gt, inArray, lte } from "drizzle-orm";
import { mediaUrl } from "../feed/build.ts";
import type { ParticipantContext } from "../participants/session.ts";

interface ActorProfile {
  name?: string;
  picture?: string;
}

/**
 * Sets up any scripted reactions to a participant's nth post or comment. A reply becomes a comment
 * with a future `visible_at`. Nothing has to run later, since the feed and notifications only count
 * what has come due.
 */
export async function scheduleReactions(
  tx: Transaction,
  context: ParticipantContext,
  trigger: {
    on: "post" | "comment";
    nth: number;
    contentId: string;
    /** What a scripted reply should appear under: the post, or with threads, the comment. */
    replyUnderId: string;
    now: Date;
  },
) {
  const reactions = await tx
    .select()
    .from(schema.scriptedReactions)
    .where(
      and(
        eq(schema.scriptedReactions.studyVersionId, context.studyVersionId),
        eq(schema.scriptedReactions.on, trigger.on),
        eq(schema.scriptedReactions.nth, trigger.nth),
      ),
    );

  for (const reaction of reactions) {
    if (reaction.conditions.length > 0 && !reaction.conditions.includes(context.conditionKey)) {
      continue;
    }

    // A reaction can't use a feature that's off in this condition.
    const features = featuresFor(context.settings, context.conditionKey);
    if (
      (reaction.type === "reply" && !features.comments) ||
      (reaction.type === "like" && !features.likes) ||
      ((reaction.type === "up" || reaction.type === "down") && !features.votes) ||
      (reaction.type === "read" && !features.notifications) ||
      (reaction.type === "remove" && !features.removal) ||
      (reaction.type === "warn" && !features.warnings)
    ) {
      continue;
    }

    const dueAt = new Date(trigger.now.getTime() + reaction.afterMs);
    let replyContentId: string | null = null;

    if (reaction.type === "reply") {
      const [reply] = await tx
        .insert(schema.content)
        .values({
          studyVersionId: context.studyVersionId,
          worldId: context.worldId,
          parentId: trigger.replyUnderId,
          authorActorId: reaction.actorId,
          kind: "comment",
          body: reaction.body ?? "",
          visibleAt: dueAt,
          class: reaction.class,
        })
        .returning({ id: schema.content.id });
      replyContentId = reply?.id ?? null;
    }

    await tx.insert(schema.notifications).values({
      worldId: context.worldId,
      recipientActorId: context.actorId,
      actorId: reaction.actorId,
      type: reaction.type,
      targetContentId: trigger.contentId,
      replyContentId,
      ...(reaction.type === "remove" || reaction.type === "warn" ? { reason: reaction.body } : {}),
      dueAt,
    });

    await recordEvent(tx, {
      type: "reaction.scheduled",
      payload: {
        reaction: reaction.type as "read" | "like" | "reply" | "up" | "down" | "remove" | "warn",
        dueAt: dueAt.toISOString(),
        ...((reaction.type === "remove" || reaction.type === "warn") && reaction.body
          ? { reason: reaction.body }
          : {}),
      },
      worldId: context.worldId,
      studyVersionId: context.studyVersionId,
      participantId: context.participantId,
      conditionId: context.conditionId,
      actorId: reaction.actorId,
      targetContentId: trigger.contentId,
      source: "script",
      occurredAt: trigger.now,
    });
  }
}

async function lastViewedAt(db: Database, context: ParticipantContext): Promise<Date | null> {
  const [membership] = await db
    .select({ viewedAt: schema.worldMemberships.notificationsViewedAt })
    .from(schema.worldMemberships)
    .where(
      and(
        eq(schema.worldMemberships.worldId, context.worldId),
        eq(schema.worldMemberships.participantId, context.participantId),
      ),
    );
  return membership?.viewedAt ?? null;
}

export async function countUnreadNotifications(
  db: Database,
  context: ParticipantContext,
  now = new Date(),
): Promise<number> {
  const viewedAt = await lastViewedAt(db, context);
  const [row] = await db
    .select({ total: count() })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.worldId, context.worldId),
        eq(schema.notifications.recipientActorId, context.actorId),
        inArray(schema.notifications.type, SHOWN_TO_PARTICIPANTS),
        lte(schema.notifications.dueAt, now),
        viewedAt ? gt(schema.notifications.dueAt, viewedAt) : undefined,
      ),
    );
  return row?.total ?? 0;
}

export interface NotificationItem {
  key: string;
  type: "read" | "like" | "reply" | "remove" | "warn";
  actors: { username: string; name: string; pictureUrl: string | null }[];
  /** Whether this reacts to their post or their comment. */
  targetKind: "post" | "comment";
  targetBody: string;
  postId: string;
  commentId: string | null;
  targetImageUrl: string | null;
  replyBody: string | null;
  /** Why a moderator removed it, if they said. */
  reason: string | null;
  at: string;
  unread: boolean;
}

/** Votes change a score without telling anyone who voted, as on the platforms that have them. */
const SHOWN_TO_PARTICIPANTS = ["read", "like", "reply", "remove", "warn"];

/**
 * Notifications that have come due, newest first. Reads and likes on the same content get grouped
 * into one, as old Truman did ("Ann and 3 others liked your post"). Replies stay separate.
 */
export async function listNotifications(
  db: Database,
  context: ParticipantContext,
  mediaPublicUrl: string,
  now = new Date(),
): Promise<NotificationItem[]> {
  const viewedAt = await lastViewedAt(db, context);
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.worldId, context.worldId),
        eq(schema.notifications.recipientActorId, context.actorId),
        inArray(schema.notifications.type, SHOWN_TO_PARTICIPANTS),
        lte(schema.notifications.dueAt, now),
      ),
    );
  if (rows.length === 0) {
    return [];
  }

  const actorRows = await db
    .select()
    .from(schema.actors)
    .where(inArray(schema.actors.id, [...new Set(rows.map((row) => row.actorId))]));
  const contentIds = [
    ...new Set(
      rows.flatMap((row) => [
        row.targetContentId,
        ...(row.replyContentId ? [row.replyContentId] : []),
      ]),
    ),
  ];
  const contentRows = await db
    .select()
    .from(schema.content)
    .where(inArray(schema.content.id, contentIds));

  const actorById = new Map(actorRows.map((actor) => [actor.id, actor]));
  const contentById = new Map(contentRows.map((item) => [item.id, item]));

  // What's above a comment isn't always loaded yet, and a link needs the post at the top.
  let missing = contentRows.flatMap(({ parentId }) =>
    parentId && !contentById.has(parentId) ? [parentId] : [],
  );
  while (missing.length > 0) {
    const parents = await db
      .select()
      .from(schema.content)
      .where(inArray(schema.content.id, [...new Set(missing)]));
    for (const parent of parents) {
      contentById.set(parent.id, parent);
    }
    missing = parents.flatMap(({ parentId }) =>
      parentId && !contentById.has(parentId) ? [parentId] : [],
    );
  }
  const postOf = (contentId: string) => {
    let current = contentById.get(contentId);
    while (current?.parentId && contentById.has(current.parentId)) {
      current = contentById.get(current.parentId);
    }
    return current?.id ?? contentId;
  };
  const toActor = (actorId: string) => {
    const actor = actorById.get(actorId);
    const profile = (actor?.profile ?? {}) as ActorProfile;
    return {
      username: actor?.username ?? "",
      name: profile.name ?? actor?.username ?? "",
      pictureUrl: profile.picture ? mediaUrl(profile.picture, mediaPublicUrl) : null,
    };
  };

  const groups = new Map<string, NotificationItem>();
  for (const row of rows) {
    const key =
      row.type === "reply" || row.type === "remove" || row.type === "warn"
        ? row.id
        : `${row.type}:${row.targetContentId}`;
    const at = row.dueAt.toISOString();
    const unread = !viewedAt || row.dueAt > viewedAt;
    const existing = groups.get(key);

    if (existing) {
      existing.actors.push(toActor(row.actorId));
      if (at > existing.at) {
        existing.at = at;
      }
      existing.unread = existing.unread || unread;
      continue;
    }

    const target = contentById.get(row.targetContentId);
    groups.set(key, {
      key,
      type: row.type as NotificationItem["type"],
      actors: [toActor(row.actorId)],
      targetKind: target?.kind === "comment" ? "comment" : "post",
      postId: postOf(row.targetContentId),
      commentId: row.replyContentId ?? (target?.kind === "comment" ? target.id : null),
      targetBody: target?.body ?? "",
      targetImageUrl: target?.attachments[0]
        ? mediaUrl(target.attachments[0].key, mediaPublicUrl)
        : null,
      replyBody: row.replyContentId ? (contentById.get(row.replyContentId)?.body ?? null) : null,
      reason: row.reason,
      at,
      unread,
    });
  }

  return [...groups.values()].sort((a, b) => b.at.localeCompare(a.at));
}
