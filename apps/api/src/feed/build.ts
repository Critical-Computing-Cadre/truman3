import { type FeedAuthor, type FeedPost, featureOn, type StudySettings } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import {
  type AssembledFeed,
  assembleFeed,
  type FeedCandidate,
  type FeedSettings,
  feedSettingsFor,
} from "@truman3/feed";
import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { ParticipantContext } from "../participants/session.ts";

type ContentRow = typeof schema.content.$inferSelect;

/** What the feed needs about a post or comment, whether it's frozen or still a draft. */
export type FeedContent = Pick<
  ContentRow,
  | "id"
  | "kind"
  | "parentId"
  | "authorActorId"
  | "body"
  | "mediaKey"
  | "offsetMs"
  | "visibleAt"
  | "position"
  | "baseLikes"
  | "conditions"
>;

/** What the feed needs about an author. */
export interface FeedActor {
  id: string;
  username: string;
  profile: unknown;
}

export async function loadAuthors(db: Database, ids: string[]): Promise<Map<string, FeedActor>> {
  const rows = ids.length
    ? await db.select().from(schema.actors).where(inArray(schema.actors.id, ids))
    : [];
  return new Map(rows.map((actor) => [actor.id, actor]));
}

interface ActorProfile {
  name?: string;
  picture?: string;
}

/** A stored media key becomes a URL. Hosted media is already a full URL. */
export function mediaUrl(key: string, publicUrl: string): string {
  return /^https?:\/\//.test(key) ? key : `${publicUrl}/${key}`;
}

/** Scripted content is timed from the start of the world. Everything else has an actual time. */
export function contentTimeMs(item: FeedContent, worldStartMs: number): number {
  if (item.visibleAt) {
    return item.visibleAt.getTime();
  }
  return worldStartMs + (item.offsetMs ?? 0);
}

/** Comments stay off the screen, and out of what's recorded as shown, when the feature's off. */
export function shownOnThisPlatform<T extends Pick<ContentRow, "kind">>(
  rows: readonly T[],
  settings: StudySettings,
  conditionKey: string,
): readonly T[] {
  return featureOn(settings, conditionKey, "comments")
    ? rows
    : rows.filter(({ kind }) => kind !== "comment");
}

export function toCandidate(item: FeedContent, worldStartMs: number): FeedCandidate {
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

/** Turns what the feed decided into what a browser draws. */
export async function shapeFeedPosts({
  loadAuthors,
  mediaPublicUrl,
  feed,
  rows,
  worldStartMs,
  viewerActorId,
  likedContentIds,
  flaggedContentIds,
  likesFromReactions,
}: {
  loadAuthors: (ids: string[]) => Promise<ReadonlyMap<string, FeedActor>>;
  mediaPublicUrl: string;
  feed: AssembledFeed;
  rows: readonly FeedContent[];
  worldStartMs: number;
  viewerActorId: string;
  likedContentIds: ReadonlySet<string>;
  flaggedContentIds: ReadonlySet<string>;
  likesFromReactions: ReadonlyMap<string, number>;
}): Promise<FeedPost[]> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const shownIds = feed.posts.flatMap((post) => [post.id, ...post.commentIds]);
  const authorIds = [...new Set(shownIds.map((id) => (byId.get(id) as FeedContent).authorActorId))];
  const authorById = await loadAuthors(authorIds);

  const toAuthor = (actorId: string): FeedAuthor => {
    const actor = authorById.get(actorId) as FeedActor;
    const profile = actor.profile as ActorProfile;
    return {
      username: actor.username,
      name: profile.name ?? actor.username,
      pictureUrl: profile.picture ? mediaUrl(profile.picture, mediaPublicUrl) : null,
      isViewer: actor.id === viewerActorId,
    };
  };

  const common = (item: FeedContent) => {
    const liked = likedContentIds.has(item.id);
    return {
      id: item.id,
      author: toAuthor(item.authorActorId),
      body: item.body,
      at: new Date(contentTimeMs(item, worldStartMs)).toISOString(),
      likes: item.baseLikes + (likesFromReactions.get(item.id) ?? 0) + (liked ? 1 : 0),
      liked,
      flagged: flaggedContentIds.has(item.id),
    };
  };

  return feed.posts.map((post) => {
    const item = byId.get(post.id) as FeedContent;
    return {
      ...common(item),
      imageUrl: item.mediaKey ? mediaUrl(item.mediaKey, mediaPublicUrl) : null,
      comments: post.commentIds.map((id) => ({
        ...common(byId.get(id) as FeedContent),
        depth: post.commentDepths[id] ?? 0,
      })),
    };
  });
}

export interface BuildFeedOptions {
  now?: Date;
  /** Where this is being shown, for the record of what participants saw. */
  surface?: string;
  /** Only this actor's posts, as on a profile page. */
  authorActorId?: string;
  /** Replaces the settings the condition would use, as on a profile page. */
  settings?: FeedSettings;
  /** Changes on each page load. Only matters to studies that reshuffle on each visit. */
  visit?: number | undefined;
}

/** Works out what a participant sees now, and records that it was shown. */
export async function buildFeed(
  { db, mediaPublicUrl }: FeedDependencies,
  context: ParticipantContext,
  { now = new Date(), surface = "feed", authorActorId, settings, visit }: BuildFeedOptions = {},
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
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const postOf = (row: ContentRow) => {
    let current = row;
    for (let step = 0; current.parentId && step < rows.length; step++) {
      current = rowsById.get(current.parentId) as ContentRow;
    }
    return current;
  };
  const inScope = (row: ContentRow) =>
    !authorActorId || postOf(row).authorActorId === authorActorId;

  const feedSettings = settings ?? feedSettingsFor(context.settings, context.conditionKey);
  const seed =
    feedSettings.reshuffleEachVisit && visit !== undefined
      ? (context.seed ^ visit) >>> 0
      : context.seed;

  const feed = assembleFeed(
    shownOnThisPlatform(rows.filter(inScope), context.settings, context.conditionKey).map((row) =>
      toCandidate(row, worldStartMs),
    ),
    {
      actorId: context.actorId,
      conditionKey: context.conditionKey,
      flaggedContentIds: state.flaggedContentIds,
      viewedContentIds: state.viewedContentIds,
      blockedActorIds: state.blockedActorIds,
    },
    feedSettings,
    {
      nowMs: now.getTime(),
      seed,
      threaded: featureOn(context.settings, context.conditionKey, "threads"),
    },
  );

  const reactionLikes = await db
    .select({ contentId: schema.notifications.targetContentId })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.worldId, context.worldId),
        eq(schema.notifications.type, "like"),
        lte(schema.notifications.dueAt, now),
      ),
    );
  const likesFromReactions = new Map<string, number>();
  for (const { contentId } of reactionLikes) {
    likesFromReactions.set(contentId, (likesFromReactions.get(contentId) ?? 0) + 1);
  }

  await db.insert(schema.feedImpressions).values({
    worldId: context.worldId,
    viewerActorId: context.actorId,
    conditionId: context.conditionId,
    surface,
    ranker: feed.ranker,
    rankerVersion: feed.rankerVersion,
    seed: feed.seed,
    shownAt: now,
    items: feed.posts.map((post, index) => ({
      contentId: post.id,
      position: index,
      pinned: post.pinned,
      commentIds: post.commentIds,
      ...(post.score === undefined ? {} : { score: post.score }),
    })),
  });

  return shapeFeedPosts({
    loadAuthors: (ids) => loadAuthors(db, ids),
    mediaPublicUrl,
    feed,
    rows,
    worldStartMs,
    viewerActorId: context.actorId,
    likedContentIds: state.likedContentIds,
    flaggedContentIds: state.flaggedContentIds,
    likesFromReactions,
  });
}
