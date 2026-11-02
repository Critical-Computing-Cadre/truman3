import type { FeedAuthor, FeedPost } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { assembleFeed, type FeedCandidate, feedSettingsFor } from "@truman3/feed";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { ParticipantContext } from "../participants/session.ts";

type ContentRow = typeof schema.content.$inferSelect;
type ActorRow = typeof schema.actors.$inferSelect;

interface ActorProfile {
  name?: string;
  picture?: string;
}

/** A stored media key becomes a URL. Hosted media is already a full URL. */
export function mediaUrl(key: string, publicUrl: string): string {
  return /^https?:\/\//.test(key) ? key : `${publicUrl}/${key}`;
}

/** Scripted content is timed from the start of the world. Everything else has an actual time. */
export function contentTimeMs(item: ContentRow, worldStartMs: number): number {
  if (item.visibleAt) {
    return item.visibleAt.getTime();
  }
  return worldStartMs + (item.offsetMs ?? 0);
}

function toCandidate(item: ContentRow, worldStartMs: number): FeedCandidate {
  return {
    id: item.id,
    kind: item.kind as FeedCandidate["kind"],
    parentId: item.parentId,
    authorActorId: item.authorActorId,
    timeMs: contentTimeMs(item, worldStartMs),
    position: item.position,
    conditions: item.conditions,
  };
}

export interface FeedDependencies {
  db: Database;
  mediaPublicUrl: string;
}

/** What a participant has done, as sets for quick lookups. */
async function loadViewerState(db: Database, context: ParticipantContext) {
  const interactions = await db
    .select()
    .from(schema.contentInteractions)
    .where(
      and(
        eq(schema.contentInteractions.worldId, context.worldId),
        eq(schema.contentInteractions.actorId, context.actorId),
      ),
    );
  const blocks = await db
    .select({ targetActorId: schema.actorRelations.targetActorId })
    .from(schema.actorRelations)
    .where(
      and(
        eq(schema.actorRelations.worldId, context.worldId),
        eq(schema.actorRelations.actorId, context.actorId),
        eq(schema.actorRelations.kind, "block"),
      ),
    );

  const idsOfKind = (kind: string) =>
    new Set(interactions.filter((row) => row.kind === kind).map((row) => row.contentId));

  return {
    likedContentIds: idsOfKind("like"),
    flaggedContentIds: idsOfKind("flag"),
    viewedContentIds: idsOfKind("view"),
    blockedActorIds: new Set(blocks.map((row) => row.targetActorId)),
  };
}

/** Works out what a participant sees now, and records that it was shown. */
export async function buildFeed(
  { db, mediaPublicUrl }: FeedDependencies,
  context: ParticipantContext,
  now = new Date(),
): Promise<FeedPost[]> {
  const worldStartMs = context.worldStartedAt.getTime();

  const rows = await db
    .select()
    .from(schema.content)
    .where(
      or(
        and(
          eq(schema.content.studyVersionId, context.studyVersionId),
          isNull(schema.content.worldId),
        ),
        eq(schema.content.worldId, context.worldId),
      ),
    );

  const state = await loadViewerState(db, context);
  const feed = assembleFeed(
    rows.map((row) => toCandidate(row, worldStartMs)),
    {
      actorId: context.actorId,
      conditionKey: context.conditionKey,
      flaggedContentIds: state.flaggedContentIds,
      viewedContentIds: state.viewedContentIds,
      blockedActorIds: state.blockedActorIds,
    },
    feedSettingsFor(context.settings, context.conditionKey),
    { nowMs: now.getTime(), seed: context.seed },
  );

  const byId = new Map(rows.map((row) => [row.id, row]));
  const shownIds = feed.posts.flatMap((post) => [post.id, ...post.commentIds]);
  const authorIds = [...new Set(shownIds.map((id) => (byId.get(id) as ContentRow).authorActorId))];
  const authors = authorIds.length
    ? await db.select().from(schema.actors).where(inArray(schema.actors.id, authorIds))
    : [];
  const authorById = new Map(authors.map((actor) => [actor.id, actor]));

  const toAuthor = (actorId: string): FeedAuthor => {
    const actor = authorById.get(actorId) as ActorRow;
    const profile = actor.profile as ActorProfile;
    return {
      username: actor.username,
      name: profile.name ?? actor.username,
      pictureUrl: profile.picture ? mediaUrl(profile.picture, mediaPublicUrl) : null,
      isViewer: actor.id === context.actorId,
    };
  };

  const common = (item: ContentRow) => {
    const liked = state.likedContentIds.has(item.id);
    return {
      id: item.id,
      author: toAuthor(item.authorActorId),
      body: item.body,
      at: new Date(contentTimeMs(item, worldStartMs)).toISOString(),
      likes: item.baseLikes + (liked ? 1 : 0),
      liked,
      flagged: state.flaggedContentIds.has(item.id),
    };
  };

  await db.insert(schema.feedImpressions).values({
    worldId: context.worldId,
    viewerActorId: context.actorId,
    conditionId: context.conditionId,
    ranker: feed.ranker,
    rankerVersion: feed.rankerVersion,
    shownAt: now,
    items: feed.posts.map((post, index) => ({
      contentId: post.id,
      position: index,
      pinned: post.pinned,
      commentIds: post.commentIds,
      ...(post.score === undefined ? {} : { score: post.score }),
    })),
  });

  return feed.posts.map((post) => {
    const item = byId.get(post.id) as ContentRow;
    return {
      ...common(item),
      imageUrl: item.mediaKey ? mediaUrl(item.mediaKey, mediaPublicUrl) : null,
      comments: post.commentIds.map((id) => common(byId.get(id) as ContentRow)),
    };
  });
}
