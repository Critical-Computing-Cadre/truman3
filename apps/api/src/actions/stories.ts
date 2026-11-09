import type { FeedStory, Highlight, StoryGroup } from "@truman3/core";
import { featureOn } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { and, asc, eq, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { contentTimeMs, hiddenByBan, loadBans, mediaUrl } from "../feed/build.ts";
import type { ParticipantContext } from "../participants/session.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

interface Profile {
  name?: string;
  picture?: string;
}

/**
 * A story that's up for this person now, or null. With `orHighlighted`, a story kept in a highlight
 * also counts after it's left the row, on a platform with highlights.
 */
export async function findLiveStory(
  db: Database,
  context: ParticipantContext,
  id: string,
  now: Date,
  orHighlighted = false,
) {
  const [story] = await db
    .select()
    .from(schema.content)
    .where(
      and(
        eq(schema.content.id, id),
        eq(schema.content.kind, "story"),
        eq(schema.content.studyVersionId, context.studyVersionId),
        or(isNull(schema.content.worldId), eq(schema.content.worldId, context.worldId)),
      ),
    );
  if (!story) {
    return null;
  }
  const startMs = contentTimeMs(story, context.worldStartedAt.getTime());
  const posted = startMs <= now.getTime();
  const live = posted && now.getTime() < startMs + (story.lastsMs ?? DAY_MS);
  const kept =
    orHighlighted &&
    posted &&
    story.highlight !== null &&
    featureOn(context.settings, context.conditionKey, "highlights");
  const inCondition =
    story.conditions.length === 0 || story.conditions.includes(context.conditionKey);
  return (live || kept) && inCondition ? story : null;
}

/**
 * Stories that are up now, grouped by who posted them. This person's own come first, then those
 * they haven't finished, then the rest, and within each, the newest first. Anyone blocked, muted, or
 * banned since doesn't appear.
 */
export async function listStories(
  db: Database,
  context: ParticipantContext,
  mediaPublicUrl: string,
  now: Date,
): Promise<StoryGroup[]> {
  if (!featureOn(context.settings, context.conditionKey, "stories")) {
    return [];
  }
  const nowMs = now.getTime();
  const worldStartMs = context.worldStartedAt.getTime();
  const closeFriendsOn = featureOn(context.settings, context.conditionKey, "closeFriends");
  const rows = await db
    .select()
    .from(schema.content)
    .where(
      and(
        eq(schema.content.kind, "story"),
        eq(schema.content.studyVersionId, context.studyVersionId),
        or(isNull(schema.content.worldId), eq(schema.content.worldId, context.worldId)),
      ),
    )
    .orderBy(asc(schema.content.offsetMs), asc(schema.content.visibleAt));
  const relations = await db
    .select()
    .from(schema.actorRelations)
    .where(
      and(
        eq(schema.actorRelations.worldId, context.worldId),
        eq(schema.actorRelations.actorId, context.actorId),
        inArray(schema.actorRelations.kind, ["block", "mute"]),
      ),
    );
  const away = new Set(relations.map(({ targetActorId }) => targetActorId));
  const bans = await loadBans(db, context, now);
  const live = rows.filter((row) => {
    const startMs = contentTimeMs(row, worldStartMs);
    return (
      startMs <= nowMs &&
      nowMs < startMs + (row.lastsMs ?? DAY_MS) &&
      (row.conditions.length === 0 || row.conditions.includes(context.conditionKey)) &&
      !away.has(row.authorActorId) &&
      !hiddenByBan(row, new Map(), bans, worldStartMs)
    );
  });
  if (live.length === 0) {
    return [];
  }
  const seen = await seenStoryIds(
    db,
    context,
    live.map(({ id }) => id),
  );
  const authors = await db
    .select()
    .from(schema.actors)
    .where(inArray(schema.actors.id, [...new Set(live.map((row) => row.authorActorId))]));

  const groups = new Map<string, StoryGroup & { latestMs: number }>();
  for (const row of live) {
    const author = authors.find(({ id }) => id === row.authorActorId);
    const profile = (author?.profile ?? {}) as Profile;
    const atMs = contentTimeMs(row, worldStartMs);
    const group = groups.get(row.authorActorId) ?? {
      author: {
        username: author?.username ?? "",
        name: profile.name ?? author?.username ?? "",
        pictureUrl: profile.picture ? mediaUrl(profile.picture, mediaPublicUrl) : null,
        isViewer: row.authorActorId === context.actorId,
      },
      stories: [],
      allSeen: true,
      closeFriends: false,
      latestMs: 0,
    };
    const picture = row.attachments[0];
    if (!picture) {
      continue;
    }
    const closeFriends = closeFriendsOn && row.closeFriends;
    group.stories.push({
      id: row.id,
      imageUrl: mediaUrl(picture.key, mediaPublicUrl),
      ...(row.body ? { caption: row.body } : {}),
      at: new Date(atMs).toISOString(),
      seen: seen.has(row.id) || row.authorActorId === context.actorId,
      ...(closeFriends ? { closeFriends: true } : {}),
    });
    group.closeFriends = group.closeFriends || closeFriends;
    group.allSeen = group.allSeen && (seen.has(row.id) || row.authorActorId === context.actorId);
    group.latestMs = Math.max(group.latestMs, atMs);
    groups.set(row.authorActorId, group);
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        Number(b.author.isViewer) - Number(a.author.isViewer) ||
        Number(a.allSeen) - Number(b.allSeen) ||
        b.latestMs - a.latestMs,
    )
    .map(({ latestMs: _latest, ...group }) => group);
}

/**
 * Stories kept on someone's profile, grouped by the highlight's name, in the order each began. They
 * still open after leaving the row. Only what's been posted by now, in this person's condition.
 */
export async function highlightsOf(
  db: Database,
  context: ParticipantContext,
  actorId: string,
  mediaPublicUrl: string,
  now: Date,
): Promise<Highlight[]> {
  if (
    !featureOn(context.settings, context.conditionKey, "stories") ||
    !featureOn(context.settings, context.conditionKey, "highlights")
  ) {
    return [];
  }
  const worldStartMs = context.worldStartedAt.getTime();
  const rows = (
    await db
      .select()
      .from(schema.content)
      .where(
        and(
          eq(schema.content.kind, "story"),
          eq(schema.content.authorActorId, actorId),
          eq(schema.content.studyVersionId, context.studyVersionId),
          isNotNull(schema.content.highlight),
          or(isNull(schema.content.worldId), eq(schema.content.worldId, context.worldId)),
        ),
      )
  )
    .filter(
      (row) =>
        contentTimeMs(row, worldStartMs) <= now.getTime() &&
        (row.conditions.length === 0 || row.conditions.includes(context.conditionKey)),
    )
    .sort((a, b) => contentTimeMs(a, worldStartMs) - contentTimeMs(b, worldStartMs));
  if (rows.length === 0) {
    return [];
  }
  const seen = await seenStoryIds(
    db,
    context,
    rows.map(({ id }) => id),
  );
  const closeFriendsOn = featureOn(context.settings, context.conditionKey, "closeFriends");
  const highlights = new Map<string, FeedStory[]>();
  for (const row of rows) {
    const picture = row.attachments[0];
    if (!picture) {
      continue;
    }
    const title = row.highlight as string;
    highlights.set(title, [
      ...(highlights.get(title) ?? []),
      {
        id: row.id,
        imageUrl: mediaUrl(picture.key, mediaPublicUrl),
        ...(row.body ? { caption: row.body } : {}),
        at: new Date(contentTimeMs(row, worldStartMs)).toISOString(),
        seen: seen.has(row.id) || row.authorActorId === context.actorId,
        ...(closeFriendsOn && row.closeFriends ? { closeFriends: true } : {}),
      },
    ]);
  }
  return [...highlights].map(([title, stories]) => ({ title, stories }));
}

/** Which of these stories this person has opened. */
async function seenStoryIds(db: Database, context: ParticipantContext, ids: string[]) {
  return new Set(
    (
      await db
        .select({ contentId: schema.contentInteractions.contentId })
        .from(schema.contentInteractions)
        .where(
          and(
            eq(schema.contentInteractions.worldId, context.worldId),
            eq(schema.contentInteractions.actorId, context.actorId),
            eq(schema.contentInteractions.kind, "view"),
            inArray(schema.contentInteractions.contentId, ids),
          ),
        )
    ).map(({ contentId }) => contentId),
  );
}

/**
 * Who "viewed" someone's own story by now, as the study wrote. A story for close friends only shows
 * those on their list, as only they could have seen it.
 */
export async function storyViewers(
  db: Database,
  context: ParticipantContext,
  storyId: string,
  mediaPublicUrl: string,
  now: Date,
  closeFriendsOnly = false,
) {
  const friends = closeFriendsOnly
    ? new Set(
        (
          await db
            .select({ id: schema.actorRelations.targetActorId })
            .from(schema.actorRelations)
            .where(
              and(
                eq(schema.actorRelations.worldId, context.worldId),
                eq(schema.actorRelations.actorId, context.actorId),
                eq(schema.actorRelations.kind, "closeFriend"),
              ),
            )
        ).map(({ id }) => id),
      )
    : null;
  const rows = await db
    .select({ actor: schema.actors })
    .from(schema.notifications)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.notifications.actorId))
    .where(
      and(
        eq(schema.notifications.worldId, context.worldId),
        eq(schema.notifications.targetContentId, storyId),
        eq(schema.notifications.type, "read"),
        lte(schema.notifications.dueAt, now),
      ),
    )
    .orderBy(asc(schema.notifications.dueAt));
  return rows
    .filter(({ actor }) => !friends || friends.has(actor.id))
    .map(({ actor }) => {
      const profile = actor.profile as Profile;
      return {
        username: actor.username,
        name: profile.name ?? actor.username,
        pictureUrl: profile.picture ? mediaUrl(profile.picture, mediaPublicUrl) : null,
      };
    });
}
