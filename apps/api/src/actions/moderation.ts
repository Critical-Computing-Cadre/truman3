import type { FeedWarning, ModLogEntry } from "@truman3/core";
import { featureOn } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { contentTimeMs, loadAuthors, loadRemovals, loadSpacesFor } from "../feed/build.ts";
import type { ParticipantContext } from "../participants/session.ts";

const nameOf = (actor: { username: string; profile: unknown } | undefined) =>
  (actor?.profile as { name?: string } | undefined)?.name ?? actor?.username ?? "";

/** Warnings that have come due and this person hasn't acknowledged, so they stay on screen. */
export async function listWarnings(
  db: Database,
  context: ParticipantContext,
  now = new Date(),
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
  spaceKey?: string,
  now = new Date(),
): Promise<ModLogEntry[]> {
  const removals = await loadRemovals(db, context, now);
  if (removals.size === 0) {
    return [];
  }
  const worldStartMs = context.worldStartedAt.getTime();
  const rows = await db
    .select()
    .from(schema.content)
    .where(
      and(
        eq(schema.content.studyVersionId, context.studyVersionId),
        inArray(schema.content.id, [...removals.keys()]),
      ),
    );

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
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
