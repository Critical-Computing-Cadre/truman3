import type { FeedWarning, ModLogEntry } from "@truman3/core";
import { featureOn, featuresFor, recordsUnpostedText, ruleMatches } from "@truman3/core";
import { type Database, recordEvent, schema, type Transaction } from "@truman3/db";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import {
  contentTimeMs,
  loadAuthors,
  loadBans,
  loadRemovals,
  loadSpacesFor,
} from "../feed/build.ts";
import type { ParticipantContext } from "../participants/session.ts";

const nameOf = (actor: { username: string; profile: unknown } | undefined) =>
  (actor?.profile as { name?: string } | undefined)?.name ?? actor?.username ?? "";

/** Warnings that have come due and this person hasn't acknowledged, so they stay on screen. */
export async function listWarnings(
  db: Database,
  context: ParticipantContext,
  now: Date,
): Promise<FeedWarning[]> {
  const rows = await db
    .select({ warning: schema.notifications, kind: schema.content.kind })
    .from(schema.notifications)
    .innerJoin(schema.content, eq(schema.content.id, schema.notifications.targetContentId))
    .where(
      and(
        eq(schema.notifications.worldId, context.worldId),
        eq(schema.notifications.recipientActorId, context.actorId),
        eq(schema.notifications.type, "warn"),
        isNull(schema.notifications.acknowledgedAt),
        lte(schema.notifications.dueAt, now),
      ),
    )
    .orderBy(asc(schema.notifications.dueAt));
  const moderators = await loadAuthors(db, [...new Set(rows.map((row) => row.warning.actorId))]);
  return rows.map(({ warning, kind }) => ({
    id: warning.id,
    by: nameOf(moderators.get(warning.actorId)),
    message: warning.reason ?? "",
    kind: kind === "comment" ? ("comment" as const) : ("post" as const),
    at: warning.dueAt.toISOString(),
  }));
}

/**
 * What moderators have removed so far, as this person's world has it, newest first. It's worked out
 * from the removals themselves, so it can't disagree with what's on screen. It leaves out anything
 * this person couldn't otherwise see, and never includes what was said.
 */
export async function listModLog(
  db: Database,
  context: ParticipantContext,
  spaceKey: string | undefined,
  now: Date,
): Promise<ModLogEntry[]> {
  const removals = await loadRemovals(db, context, now);
  const bans = await loadBans(db, context, now);
  const worldStartMs = context.worldStartedAt.getTime();
  const rows = removals.size
    ? await db
        .select()
        .from(schema.content)
        .where(
          and(
            eq(schema.content.studyVersionId, context.studyVersionId),
            inArray(schema.content.id, [...removals.keys()]),
          ),
        )
    : [];

  // A comment says nothing about its space, so this climbs to the post it's on.
  const postOf = async (row: (typeof rows)[number]) => {
    let current = row;
    while (current.parentId) {
      const [parent] = await db
        .select()
        .from(schema.content)
        .where(eq(schema.content.id, current.parentId));
      if (!parent) {
        break;
      }
      current = parent;
    }
    return current;
  };

  const spacesOn = featureOn(context.settings, context.conditionKey, "spaces");
  const spaces = new Map(
    (spacesOn ? await loadSpacesFor(db, context) : []).map((space) => [space.id, space]),
  );
  const people = await loadAuthors(db, [
    ...new Set([
      ...[...removals.values()].map(({ actorId }) => actorId),
      ...rows.map(({ authorActorId }) => authorActorId),
      ...bans.flatMap(({ actorId, bannedActorId }) => [actorId, bannedActorId]),
    ]),
  ]);

  const entries: ModLogEntry[] = [];
  for (const row of rows) {
    const removal = removals.get(row.id);
    const inCondition =
      row.conditions.length === 0 || row.conditions.includes(context.conditionKey);
    const appeared = contentTimeMs(row, worldStartMs) <= now.getTime();
    // What's in another participant's world has a world of its own, and never reaches this list.
    const inWorld = row.worldId === null || row.worldId === context.worldId;
    if (!removal || !inCondition || !appeared || !inWorld) {
      continue;
    }
    const post = await postOf(row);
    const space = post.spaceId ? spaces.get(post.spaceId) : undefined;
    // With spaces on, a space this condition can't see hides what's in it, as it does in the feed.
    if ((spacesOn && post.spaceId && !space) || (spaceKey && space?.key !== spaceKey)) {
      continue;
    }
    entries.push({
      id: row.id,
      at: removal.at.toISOString(),
      by: nameOf(people.get(removal.actorId)),
      kind: row.kind === "comment" ? "comment" : "post",
      authorName:
        row.authorActorId === context.actorId ? null : nameOf(people.get(row.authorActorId)),
      ...(space ? { space: { key: space.key, name: space.name } } : {}),
      ...(removal.reason ? { reason: removal.reason } : {}),
      postId: post.id,
      ...(row.kind === "comment" ? { commentId: row.id } : {}),
    });
  }
  for (const ban of bans) {
    const space = ban.spaceId ? spaces.get(ban.spaceId) : undefined;
    // A ban from a space this condition can't see stays out of the log, as what's in it does.
    if ((ban.spaceId && spacesOn && !space) || (spaceKey && space?.key !== spaceKey)) {
      continue;
    }
    const banned = people.get(ban.bannedActorId);
    entries.push({
      id: `ban:${ban.bannedActorId}:${ban.spaceId ?? "everywhere"}`,
      at: ban.at.toISOString(),
      by: nameOf(people.get(ban.actorId)),
      kind: "person",
      authorName: nameOf(banned),
      ...(banned ? { username: banned.username } : {}),
      ...(space ? { space: { key: space.key, name: space.name } } : {}),
      ...(ban.reason ? { reason: ban.reason } : {}),
    });
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

type AutoRule = typeof schema.scriptedAutoRules.$inferSelect;

/**
 * Which rules catch what someone's writing: the first that would ask if they're sure, and the first
 * that does something once it's posted. A rule that needs a feature that's off doesn't apply.
 */
export async function findAutoRules(
  db: Database,
  context: ParticipantContext,
  kind: "post" | "comment",
  text: string,
): Promise<{ confirm?: AutoRule | undefined; act?: AutoRule | undefined }> {
  const features = featuresFor(context.settings, context.conditionKey);
  if (!features.autoRules) {
    return {};
  }
  const rules = await db
    .select()
    .from(schema.scriptedAutoRules)
    .where(eq(schema.scriptedAutoRules.studyVersionId, context.studyVersionId))
    .orderBy(asc(schema.scriptedAutoRules.position));
  const caught = rules.filter(
    ({ on, conditions, action, match }) =>
      (on === "both" || on === kind) &&
      (conditions.length === 0 || conditions.includes(context.conditionKey)) &&
      (action !== "remove" || features.removal) &&
      (action !== "warn" || features.warnings) &&
      ruleMatches(match, text),
  );
  return {
    confirm: caught.find(({ action }) => action === "confirm"),
    act: caught.find(({ action }) => action !== "confirm"),
  };
}

/** Records that a rule asked someone if they're sure, with what they wrote if the study keeps that. */
export async function recordRuleAsked(
  db: Database,
  context: ParticipantContext,
  rule: AutoRule,
  text: string,
  now: Date,
) {
  await recordEvent(db, {
    type: "moderation.rule_fired",
    payload: {
      rule: rule.ref,
      action: "confirm",
      ...(recordsUnpostedText(context.settings, context.conditionKey)
        ? { unpostedText: text }
        : {}),
    },
    worldId: context.worldId,
    studyVersionId: context.studyVersionId,
    participantId: context.participantId,
    conditionId: context.conditionId,
    actorId: rule.actorId,
    source: "script",
    occurredAt: now,
  });
}

/**
 * When something's posted, what a rule does about it. A hold has two parts: while it's waiting, and
 * how it ends. As with reactions, nothing has to run later, since these count once they come due.
 */
export async function applyAutoRule(
  tx: Transaction,
  context: ParticipantContext,
  rule: AutoRule,
  contentId: string,
  now: Date,
) {
  const dueAt = new Date(now.getTime() + rule.afterMs);
  const shared = {
    worldId: context.worldId,
    studyVersionId: context.studyVersionId,
    participantId: context.participantId,
    conditionId: context.conditionId,
    actorId: rule.actorId,
    targetContentId: contentId,
    source: "script" as const,
    occurredAt: now,
  };
  await recordEvent(tx, {
    ...shared,
    type: "moderation.rule_fired",
    payload: { rule: rule.ref, action: rule.action as "remove" | "warn" | "hold" },
  });

  const notify = async (type: "remove" | "warn" | "hold" | "approve", reason: string | null) => {
    await tx.insert(schema.notifications).values({
      worldId: context.worldId,
      recipientActorId: context.actorId,
      actorId: rule.actorId,
      type,
      targetContentId: contentId,
      reason,
      dueAt,
    });
    await recordEvent(tx, {
      ...shared,
      type: "reaction.scheduled",
      payload: {
        reaction: type,
        dueAt: dueAt.toISOString(),
        ...(reason ? { reason } : {}),
      },
    });
  };

  if (rule.action === "hold") {
    await notify("hold", null);
    await notify(rule.holdOutcome === "remove" ? "remove" : "approve", rule.message);
    return;
  }
  await notify(rule.action as "remove" | "warn", rule.message);
}

/** When a hold ends, reactions come after it. If it ends in removal, nobody saw it to react. */
export function reactionsAfterRule(rule: AutoRule | undefined, now: Date) {
  if (rule?.action !== "hold") {
    return { skip: false, startAt: now };
  }
  return {
    skip: rule.holdOutcome === "remove",
    startAt: new Date(now.getTime() + rule.afterMs),
  };
}

/** Records an appeal, and sets up a moderator's answer, if the study writes one for this condition. */
export async function scheduleAppealAnswer(
  tx: Transaction,
  context: ParticipantContext,
  contentId: string,
  now: Date,
) {
  const answers = await tx
    .select()
    .from(schema.scriptedAppealAnswers)
    .where(eq(schema.scriptedAppealAnswers.studyVersionId, context.studyVersionId))
    .orderBy(asc(schema.scriptedAppealAnswers.position));
  const answer = answers.find(
    ({ conditions }) => conditions.length === 0 || conditions.includes(context.conditionKey),
  );
  if (!answer) {
    return;
  }
  const dueAt = new Date(now.getTime() + answer.afterMs);
  await tx.insert(schema.notifications).values({
    worldId: context.worldId,
    recipientActorId: context.actorId,
    actorId: answer.actorId,
    type: answer.action,
    targetContentId: contentId,
    reason: answer.message,
    dueAt,
  });
  await recordEvent(tx, {
    type: "reaction.scheduled",
    payload: {
      reaction: answer.action as "uphold" | "restore",
      dueAt: dueAt.toISOString(),
      ...(answer.message ? { reason: answer.message } : {}),
    },
    worldId: context.worldId,
    studyVersionId: context.studyVersionId,
    participantId: context.participantId,
    conditionId: context.conditionId,
    actorId: answer.actorId,
    targetContentId: contentId,
    source: "script",
    occurredAt: now,
  });
}
