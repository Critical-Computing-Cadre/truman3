import { featureOn, featuresFor } from "@truman3/core";
import { type Database, recordEvent, schema, type Transaction } from "@truman3/db";
import { and, count, eq, gt, inArray, lte } from "drizzle-orm";
import { onParticipantAct } from "../director/director.ts";
import { bannedAt, loadBans, loadRemovals, mediaUrl, pictureUrlOf } from "../feed/build.ts";
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
    on: "post" | "comment" | "story";
    nth: number;
    contentId: string;
    /** What a scripted reply should appear under: the post, or with threads, the comment. */
    replyUnderId: string;
    /** The space it's in, if any, since a ban can be from one space. */
    spaceId: string | null;
    now: Date;
    /** When delays count from, if not now, as after a hold. */
    startAt?: Date;
  },
) {
  // Beats wait for posts and comments the same way reactions do, after any hold.
  if (trigger.on !== "story") {
    await onParticipantAct(
      tx,
      context,
      { action: trigger.on, contentId: trigger.contentId, nth: trigger.nth },
      trigger.startAt ?? trigger.now,
    );
  }

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
      (reaction.type === "warn" && !features.warnings) ||
      (reaction.type === "label" && !features.labels) ||
      (reaction.type === "repost" && !features.reposts) ||
      (reaction.type === "follow" && !features.following)
    ) {
      continue;
    }

    const dueAt = new Date((trigger.startAt ?? trigger.now).getTime() + reaction.afterMs);
    // Someone already banned by then can't do this, so it isn't recorded as about to happen.
    const banned = await loadBans(tx, context, dueAt);
    if (bannedAt(banned, reaction.actorId, trigger.spaceId, dueAt.getTime())) {
      continue;
    }
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

    if (reaction.type === "repost" && trigger.on === "post") {
      await tx.insert(schema.content).values({
        studyVersionId: context.studyVersionId,
        worldId: context.worldId,
        repostOf: trigger.contentId,
        authorActorId: reaction.actorId,
        kind: "post",
        visibleAt: dueAt,
        class: reaction.class,
      });
    }

    await tx.insert(schema.notifications).values({
      worldId: context.worldId,
      recipientActorId: context.actorId,
      actorId: reaction.actorId,
      type: reaction.type,
      targetContentId: trigger.contentId,
      replyContentId,
      ...(reaction.type === "remove" || reaction.type === "warn" || reaction.type === "label"
        ? { reason: reaction.body }
        : {}),
      dueAt,
    });

    await recordEvent(tx, {
      type: "reaction.scheduled",
      payload: {
        reaction: reaction.type as
          | "read"
          | "like"
          | "reply"
          | "up"
          | "down"
          | "remove"
          | "warn"
          | "label"
          | "repost"
          | "follow",
        dueAt: dueAt.toISOString(),
        ...((reaction.type === "remove" || reaction.type === "warn" || reaction.type === "label") &&
        reaction.body
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

/**
 * What a moderator does about a flag, the first time this person flags this. Answers naming what
 * was flagged come before answers to any flag. Like a reaction, nothing has to run later.
 */
export async function scheduleFlagAnswer(
  tx: Transaction,
  context: ParticipantContext,
  target: { id: string; authorActorId: string },
  now: Date,
) {
  const features = featuresFor(context.settings, context.conditionKey);
  if (!features.flagAnswers || target.authorActorId === context.actorId) {
    return;
  }
  const answers = await tx
    .select()
    .from(schema.scriptedFlagAnswers)
    .where(eq(schema.scriptedFlagAnswers.studyVersionId, context.studyVersionId));
  const applicable = answers.filter(
    ({ conditions, action, contentId }) =>
      (conditions.length === 0 || conditions.includes(context.conditionKey)) &&
      (action !== "remove" || features.removal) &&
      (contentId === null || contentId === target.id),
  );
  const answer =
    applicable.find(({ contentId }) => contentId === target.id) ??
    applicable.find(({ contentId }) => contentId === null);
  if (!answer) {
    return;
  }

  const [already] = await tx
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.worldId, context.worldId),
        eq(schema.notifications.recipientActorId, context.actorId),
        eq(schema.notifications.targetContentId, target.id),
        inArray(schema.notifications.type, ["remove", "answer"]),
      ),
    )
    .limit(1);
  if (already) {
    return;
  }

  const dueAt = new Date(now.getTime() + answer.afterMs);
  await tx.insert(schema.notifications).values({
    worldId: context.worldId,
    recipientActorId: context.actorId,
    actorId: answer.actorId,
    type: answer.action,
    targetContentId: target.id,
    reason: answer.message,
    dueAt,
  });
  await recordEvent(tx, {
    type: "reaction.scheduled",
    payload: {
      reaction: answer.action as "remove" | "answer",
      dueAt: dueAt.toISOString(),
      ...(answer.message ? { reason: answer.message } : {}),
    },
    worldId: context.worldId,
    studyVersionId: context.studyVersionId,
    participantId: context.participantId,
    conditionId: context.conditionId,
    actorId: answer.actorId,
    targetContentId: target.id,
    source: "script",
    occurredAt: now,
  });
}

/**
 * What a moderator does about a report of a person, the first time this person reports them. An
 * answer naming them comes before one for any report. A ban only applies in this person's world.
 */
export async function scheduleReportAnswer(
  tx: Transaction,
  context: ParticipantContext,
  reportedActorId: string,
  now: Date,
) {
  const features = featuresFor(context.settings, context.conditionKey);
  if (!features.reportAnswers) {
    return;
  }
  const answers = await tx
    .select()
    .from(schema.scriptedReportAnswers)
    .where(eq(schema.scriptedReportAnswers.studyVersionId, context.studyVersionId));
  const applicable = answers.filter(
    ({ conditions, action, reportedActorId: named }) =>
      (conditions.length === 0 || conditions.includes(context.conditionKey)) &&
      (action !== "ban" || features.bans) &&
      (named === null || named === reportedActorId),
  );
  const answer =
    applicable.find(({ reportedActorId: named }) => named === reportedActorId) ??
    applicable.find(({ reportedActorId: named }) => named === null);
  if (!answer) {
    return;
  }

  const [already] = await tx
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.worldId, context.worldId),
        eq(schema.notifications.recipientActorId, context.actorId),
        eq(schema.notifications.targetActorId, reportedActorId),
      ),
    )
    .limit(1);
  if (already) {
    return;
  }

  const dueAt = new Date(now.getTime() + answer.afterMs);
  await tx.insert(schema.notifications).values({
    worldId: context.worldId,
    recipientActorId: context.actorId,
    actorId: answer.actorId,
    type: answer.action,
    targetActorId: reportedActorId,
    reason: answer.message,
    dueAt,
  });
  await recordEvent(tx, {
    type: "reaction.scheduled",
    payload: {
      reaction: answer.action as "answer" | "ban",
      dueAt: dueAt.toISOString(),
      ...(answer.message ? { reason: answer.message } : {}),
    },
    worldId: context.worldId,
    studyVersionId: context.studyVersionId,
    participantId: context.participantId,
    conditionId: context.conditionId,
    actorId: answer.actorId,
    targetActorId: reportedActorId,
    source: "script",
    occurredAt: now,
  });
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

/** What someone hears about a thread from the cast, which muting the thread stops. */
const ABOUT_A_THREAD = ["read", "like", "reply", "repost", "tag"];

/** The posts this person muted notifications about, on a platform with that. */
async function mutedThreads(db: Database, context: ParticipantContext): Promise<Set<string>> {
  if (!featureOn(context.settings, context.conditionKey, "threadMuting")) {
    return new Set();
  }
  const rows = await db
    .select({ contentId: schema.contentInteractions.contentId })
    .from(schema.contentInteractions)
    .where(
      and(
        eq(schema.contentInteractions.worldId, context.worldId),
        eq(schema.contentInteractions.actorId, context.actorId),
        eq(schema.contentInteractions.kind, "mute_thread"),
      ),
    );
  return new Set(rows.map(({ contentId }) => contentId));
}

/** The post at the top of each of these, following parents up. */
async function postsAbove(db: Database, ids: string[]): Promise<Map<string, string>> {
  const parents = new Map<string, string | null>();
  let missing = [...new Set(ids)];
  while (missing.length > 0) {
    const rows = await db
      .select({ id: schema.content.id, parentId: schema.content.parentId })
      .from(schema.content)
      .where(inArray(schema.content.id, missing));
    for (const row of rows) {
      parents.set(row.id, row.parentId);
    }
    missing = rows.flatMap(({ parentId }) =>
      parentId && !parents.has(parentId) ? [parentId] : [],
    );
  }
  return new Map(
    ids.map((id) => {
      let current = id;
      for (let step = 0; parents.get(current) && step < parents.size; step++) {
        current = parents.get(current) as string;
      }
      return [id, current];
    }),
  );
}

export async function countUnreadNotifications(
  db: Database,
  context: ParticipantContext,
  now: Date,
): Promise<number> {
  const viewedAt = await lastViewedAt(db, context);
  const unread = and(
    eq(schema.notifications.worldId, context.worldId),
    eq(schema.notifications.recipientActorId, context.actorId),
    inArray(schema.notifications.type, SHOWN_TO_PARTICIPANTS),
    lte(schema.notifications.dueAt, now),
    viewedAt ? gt(schema.notifications.dueAt, viewedAt) : undefined,
  );
  const muted = await mutedThreads(db, context);
  if (muted.size === 0) {
    const [row] = await db.select({ total: count() }).from(schema.notifications).where(unread);
    return row?.total ?? 0;
  }
  // Muted threads need each notification's post, which a count alone can't give.
  const rows = await db
    .select({
      type: schema.notifications.type,
      targetContentId: schema.notifications.targetContentId,
    })
    .from(schema.notifications)
    .where(unread);
  const above = await postsAbove(
    db,
    rows.flatMap(({ targetContentId }) => (targetContentId ? [targetContentId] : [])),
  );
  return rows.filter(
    ({ type, targetContentId }) =>
      !(
        ABOUT_A_THREAD.includes(type) &&
        targetContentId &&
        muted.has(above.get(targetContentId) ?? targetContentId)
      ),
  ).length;
}

export interface NotificationItem {
  key: string;
  type:
    | "read"
    | "like"
    | "reply"
    | "remove"
    | "warn"
    | "label"
    | "answer"
    | "ban"
    | "approve"
    | "uphold"
    | "restore"
    | "repost"
    | "follow"
    | "tag";
  actors: { username: string; name: string; pictureUrl: string | null }[];
  /** Whether this is about a post, a comment, a story, or a person someone reported. */
  targetKind: "post" | "comment" | "story" | "person";
  /** Who wrote it, or who was reported. */
  targetName: string;
  /** Whether they wrote it. If not, this answers their flag. */
  targetIsTheirs: boolean;
  targetBody: string;
  postId: string | null;
  commentId: string | null;
  targetImageUrl: string | null;
  replyBody: string | null;
  /** Why a moderator removed it, if they said, or the label they gave it. */
  reason: string | null;
  /** For an answer to an appeal, whether the appeal was of a removal or a label. */
  appealOf?: "removal" | "label";
  at: string;
  unread: boolean;
}

/** Votes change a score without telling anyone who voted, as on the platforms that have them. */
const SHOWN_TO_PARTICIPANTS = [
  "read",
  "like",
  "reply",
  "remove",
  "warn",
  "label",
  "answer",
  "ban",
  "approve",
  "uphold",
  "restore",
  "repost",
  "follow",
  "tag",
];
/** What's kept separate in a list, rather than grouped as "Ann and 3 others." */
const SHOWN_ALONE = [
  "reply",
  "remove",
  "warn",
  "label",
  "answer",
  "ban",
  "approve",
  "uphold",
  "restore",
  "tag",
];

/**
 * Notifications that have come due, newest first. Reads and likes on the same content get grouped
 * into one, as old Truman did ("Ann and 3 others liked your post"). Replies stay separate.
 */
export async function listNotifications(
  db: Database,
  context: ParticipantContext,
  mediaPublicUrl: string,
  now: Date,
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

  const contentIds = [
    ...new Set(
      rows.flatMap((row) => [
        ...(row.targetContentId ? [row.targetContentId] : []),
        ...(row.replyContentId ? [row.replyContentId] : []),
      ]),
    ),
  ];
  const contentRows = contentIds.length
    ? await db.select().from(schema.content).where(inArray(schema.content.id, contentIds))
    : [];
  const actorRows = await db
    .select()
    .from(schema.actors)
    .where(
      inArray(schema.actors.id, [
        ...new Set([
          ...rows.map((row) => row.actorId),
          ...rows.flatMap((row) => (row.targetActorId ? [row.targetActorId] : [])),
          ...contentRows.map((row) => row.authorActorId),
        ]),
      ]),
    );

  const removals = await loadRemovals(db, context, now);
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
      pictureUrl: pictureUrlOf(profile, context.conditionKey, mediaPublicUrl),
    };
  };

  const bans = await loadBans(db, context, now);
  const mutes = await db
    .select({ actorId: schema.actorRelations.targetActorId })
    .from(schema.actorRelations)
    .where(
      and(
        eq(schema.actorRelations.worldId, context.worldId),
        eq(schema.actorRelations.actorId, context.actorId),
        eq(schema.actorRelations.kind, "mute"),
      ),
    );
  const muted = new Set(mutes.map(({ actorId }) => actorId));
  const mutedPosts = await mutedThreads(db, context);
  // An answer to an appeal says what was appealed, which the appeal recorded.
  const appealOf = new Map<string, "removal" | "label">();
  if (rows.some(({ type }) => type === "uphold" || type === "restore")) {
    const appeals = await db
      .select({ targetContentId: schema.events.targetContentId, payload: schema.events.payload })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.worldId, context.worldId),
          eq(schema.events.type, "moderation.appealed"),
        ),
      );
    for (const { targetContentId, payload } of appeals) {
      if (targetContentId) {
        appealOf.set(targetContentId, (payload as { of?: "label" }).of ?? "removal");
      }
    }
  }
  const groups = new Map<string, NotificationItem>();
  for (const row of rows) {
    // Muting a thread stops hearing about it from the cast, as muting someone does.
    if (
      ABOUT_A_THREAD.includes(row.type) &&
      row.targetContentId &&
      mutedPosts.has(postOf(row.targetContentId))
    ) {
      continue;
    }
    // Muting someone means not hearing from them. A moderator's decisions are a different matter.
    if (
      ["read", "like", "reply", "repost", "follow", "tag"].includes(row.type) &&
      muted.has(row.actorId)
    ) {
      continue;
    }
    // Who saw someone's story shows in the story itself, as on these platforms, not as a notification.
    if (row.type === "read" && contentById.get(row.targetContentId ?? "")?.kind === "story") {
      continue;
    }
    // Someone banned stops reacting, even if that was already on its way. A moderator's decisions
    // stay, since they're not banned for those.
    const top = row.targetContentId ? contentById.get(postOf(row.targetContentId)) : undefined;
    if (
      ["read", "like", "reply", "repost", "follow", "tag"].includes(row.type) &&
      bannedAt(bans, row.actorId, top?.spaceId, row.dueAt.getTime())
    ) {
      continue;
    }
    const key = SHOWN_ALONE.includes(row.type) ? row.id : `${row.type}:${row.targetContentId}`;
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

    const target = row.targetContentId ? contentById.get(row.targetContentId) : undefined;
    const targetIsTheirs = target?.authorActorId === context.actorId;
    // What a moderator took down stays out of responses, unless it's this person's own.
    const withheld = !targetIsTheirs && removals.has(row.targetContentId ?? "");
    groups.set(key, {
      key,
      type: row.type as NotificationItem["type"],
      actors: [toActor(row.actorId)],
      targetKind: !target
        ? "person"
        : target.kind === "comment" || target.kind === "story"
          ? target.kind
          : "post",
      targetName: toActor(row.targetActorId ?? target?.authorActorId ?? "").name,
      postId: row.targetContentId ? postOf(row.targetContentId) : null,
      commentId: row.replyContentId ?? (target?.kind === "comment" ? target.id : null),
      targetIsTheirs,
      targetBody: withheld ? "" : (target?.body ?? ""),
      targetImageUrl:
        !withheld && target?.attachments[0]
          ? mediaUrl(target.attachments[0].key, mediaPublicUrl)
          : null,
      replyBody: row.replyContentId ? (contentById.get(row.replyContentId)?.body ?? null) : null,
      reason: row.reason,
      ...((row.type === "uphold" || row.type === "restore") && row.targetContentId
        ? { appealOf: appealOf.get(row.targetContentId) ?? "removal" }
        : {}),
      at,
      unread,
    });
  }

  return [...groups.values()].sort((a, b) => b.at.localeCompare(a.at));
}
