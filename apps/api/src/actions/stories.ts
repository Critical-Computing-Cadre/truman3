import type { StoryGroup } from "@truman3/core";
import { featureOn } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { contentTimeMs, hiddenByBan, loadBans, mediaUrl } from "../feed/build.ts";
import type { ParticipantContext } from "../participants/session.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

interface Profile {
  name?: string;
  picture?: string;
}

/** A story that's up for this person now, or null. */
export async function findLiveStory(
  db: Database,
  context: ParticipantContext,
  id: string,
  now = new Date(),
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
  const live = startMs <= now.getTime() && now.getTime() < startMs + (story.lastsMs ?? DAY_MS);
  const inCondition =
    story.conditions.length === 0 || story.conditions.includes(context.conditionKey);
  return live && inCondition ? story : null;
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
  now = new Date(),
): Promise<StoryGroup[]> {
  if (!featureOn(context.settings, context.conditionKey, "stories")) {
    return [];
  }
  const nowMs = now.getTime();
  const worldStartMs = context.worldStartedAt.getTime();
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
  const seen = new Set(
    (
      await db
        .select({ contentId: schema.contentInteractions.contentId })
        .from(schema.contentInteractions)
        .where(
          and(
            eq(schema.contentInteractions.worldId, context.worldId),
            eq(schema.contentInteractions.actorId, context.actorId),
            eq(schema.contentInteractions.kind, "view"),
            inArray(
              schema.contentInteractions.contentId,
              live.map(({ id }) => id),
            ),
          ),
        )
    ).map(({ contentId }) => contentId),
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
      latestMs: 0,
    };
    const picture = row.attachments[0];
    if (!picture) {
      continue;
    }
    group.stories.push({
      id: row.id,
      imageUrl: mediaUrl(picture.key, mediaPublicUrl),
      ...(row.body ? { caption: row.body } : {}),
      at: new Date(atMs).toISOString(),
      seen: seen.has(row.id) || row.authorActorId === context.actorId,
    });
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

/** Who "viewed" someone's own story by now, as the study wrote. */
export async function storyViewers(
  db: Database,
  context: ParticipantContext,
  storyId: string,
  mediaPublicUrl: string,
  now = new Date(),
) {
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
  return rows.map(({ actor }) => {
    const profile = actor.profile as Profile;
    return {
      username: actor.username,
      name: profile.name ?? actor.username,
      pictureUrl: profile.picture ? mediaUrl(profile.picture, mediaPublicUrl) : null,
    };
  });
}
