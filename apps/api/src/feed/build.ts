import { type FeedAuthor, type FeedPost, featureOn, type StudySettings } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import {
  type AssembledFeed,
  assembleFeed,
  type FeedCandidate,
  type FeedSettings,
  feedSettingsFor,
} from "@truman3/feed";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { ParticipantContext } from "../participants/session.ts";

type ContentRow = typeof schema.content.$inferSelect;

/** What the feed needs about a post or comment, whether it's frozen or still a draft. */
export type FeedContent = Pick<
  ContentRow,
  | "id"
  | "kind"
  | "parentId"
  | "spaceId"
  | "authorActorId"
  | "body"
  | "attachments"
  | "offsetMs"
  | "visibleAt"
  | "position"
  | "baseLikes"
  | "baseUps"
  | "baseDowns"
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
  moderator?: boolean;
}

/** What the feed needs to name a space on a post. */
export type SpaceLabels = ReadonlyMap<string, { key: string; name: string }>;

/**
 * A stored media key becomes a URL. Hosted media is already a full URL, and what participants upload
 * goes through the API, which checks who's asking. See ADR 25.
 */
export function mediaUrl(key: string, publicUrl: string): string {
  if (/^https?:\/\//.test(key)) {
    return key;
  }
  return key.startsWith("uploads/") ? `/api/media/${key}` : `${publicUrl}/${key}`;
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
    score: item.baseUps - item.baseDowns,
    conditions: item.conditions,
  };
}

/** The spaces someone's condition can see, in order, and whether they're in each. */
export async function loadSpacesFor(db: Database, context: ParticipantContext) {
  const rows = await db
    .select()
    .from(schema.spaces)
    .where(eq(schema.spaces.studyVersionId, context.studyVersionId))
    .orderBy(asc(schema.spaces.position));
  const choices = rows.length
    ? await db
        .select()
        .from(schema.spaceMemberships)
        .where(
          and(
            eq(schema.spaceMemberships.worldId, context.worldId),
            eq(schema.spaceMemberships.actorId, context.actorId),
          ),
        )
    : [];
  const chose = new Map(choices.map(({ spaceId, joined }) => [spaceId, joined]));
  return rows
    .filter(
      ({ conditions }) => conditions.length === 0 || conditions.includes(context.conditionKey),
    )
    .map((space) => ({ ...space, joined: chose.get(space.id) ?? space.startsJoined }));
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
    viewerVotes: new Map(
      interactions.flatMap(({ kind, contentId }) =>
        kind === "up" || kind === "down" ? [[contentId, kind] as const] : [],
      ),
    ),
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
  scriptedCounts,
  viewerVotes,
  spaces = new Map(),
}: {
  loadAuthors: (ids: string[]) => Promise<ReadonlyMap<string, FeedActor>>;
  mediaPublicUrl: string;
  feed: AssembledFeed;
  rows: readonly FeedContent[];
  worldStartMs: number;
  viewerActorId: string;
  likedContentIds: ReadonlySet<string>;
  flaggedContentIds: ReadonlySet<string>;
  /** What scripted actors have added so far, by type and content, such as `like:<id>`. */
  scriptedCounts: ReadonlyMap<string, number>;
  viewerVotes: ReadonlyMap<string, "up" | "down">;
  /** The spaces this viewer can see, by ID. Empty where the feature's off. */
  spaces?: SpaceLabels;
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
      ...(profile.moderator ? { moderator: true as const } : {}),
    };
  };

  const common = (item: FeedContent) => {
    const liked = likedContentIds.has(item.id);
    const vote = viewerVotes.get(item.id) ?? null;
    const scripted = (type: string) => scriptedCounts.get(`${type}:${item.id}`) ?? 0;
    return {
      id: item.id,
      author: toAuthor(item.authorActorId),
      body: item.body,
      at: new Date(contentTimeMs(item, worldStartMs)).toISOString(),
      likes: item.baseLikes + scripted("like") + (liked ? 1 : 0),
      liked,
      ups: item.baseUps + scripted("up") + (vote === "up" ? 1 : 0),
      downs: item.baseDowns + scripted("down") + (vote === "down" ? 1 : 0),
      vote,
      flagged: flaggedContentIds.has(item.id),
    };
  };

  return feed.posts.map((post) => {
    const item = byId.get(post.id) as FeedContent;
    const space = item.spaceId ? spaces.get(item.spaceId) : undefined;
    return {
      ...common(item),
      // Only these two, since whatever else a space holds has no reason to reach a browser.
      ...(space ? { space: { key: space.key, name: space.name } } : {}),
      attachments: item.attachments.map(({ type, key }) => ({
        type,
        url: mediaUrl(key, mediaPublicUrl),
      })),
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
  /** Only this space's posts, on its own page, in the order set for space pages. */
  space?: { id: string } | undefined;
  /** An order this person chose, where the study allows it. */
  sort?: "new" | "top" | undefined;
}

/** Works out what a participant sees now, and records that it was shown. */
export async function buildFeed(
  { db, mediaPublicUrl }: FeedDependencies,
  context: ParticipantContext,
  {
    now = new Date(),
    surface = "feed",
    authorActorId,
    settings,
    visit,
    space,
    sort,
  }: BuildFeedOptions = {},
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
  const spacesOn = featureOn(context.settings, context.conditionKey, "spaces");
  const spaces = spacesOn ? await loadSpacesFor(db, context) : [];
  const visibleSpaces = new Map(spaces.map((item) => [item.id, item]));
  /** With spaces off, posts in them show as ordinary posts, and a study can compare the two. */
  const inSpaces = (row: ContentRow) => {
    if (!spacesOn) {
      return true;
    }
    const { spaceId } = postOf(row);
    if (space) {
      return spaceId === space.id;
    }
    if (!spaceId) {
      return true;
    }
    const found = visibleSpaces.get(spaceId);
    // Someone's profile shows what they've written, wherever it is, and a home feed what they joined.
    return found !== undefined && (authorActorId !== undefined || found.joined);
  };
  const inScope = (row: ContentRow) =>
    (!authorActorId || postOf(row).authorActorId === authorActorId) && inSpaces(row);

  const conditionSettings = settings ?? feedSettingsFor(context.settings, context.conditionKey);
  const feedSettings: FeedSettings = {
    ...conditionSettings,
    ranker: sort ?? (space ? conditionSettings.spaceRanker : undefined) ?? conditionSettings.ranker,
  };
  const seed =
    feedSettings.reshuffleEachVisit && visit !== undefined
      ? (context.seed ^ visit) >>> 0
      : context.seed;

  const dueReactions = await db
    .select({ type: schema.notifications.type, contentId: schema.notifications.targetContentId })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.worldId, context.worldId),
        inArray(schema.notifications.type, ["like", "up", "down"]),
        lte(schema.notifications.dueAt, now),
      ),
    );
  const scriptedCounts = new Map<string, number>();
  for (const { type, contentId } of dueReactions) {
    const key = `${type}:${contentId}`;
    scriptedCounts.set(key, (scriptedCounts.get(key) ?? 0) + 1);
  }

  /** Scripted votes so far and this person's own, on top of what the study wrote. */
  const scoreOf = (row: ContentRow) => {
    const vote = state.viewerVotes.get(row.id);
    return (
      row.baseUps -
      row.baseDowns +
      (scriptedCounts.get(`up:${row.id}`) ?? 0) -
      (scriptedCounts.get(`down:${row.id}`) ?? 0) +
      (vote === "up" ? 1 : 0) -
      (vote === "down" ? 1 : 0)
    );
  };

  const feed = assembleFeed(
    shownOnThisPlatform(rows.filter(inScope), context.settings, context.conditionKey).map(
      (row) => ({
        ...toCandidate(row, worldStartMs),
        score: scoreOf(row),
      }),
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

  await db.insert(schema.feedImpressions).values({
    worldId: context.worldId,
    viewerActorId: context.actorId,
    conditionId: context.conditionId,
    surface,
    spaceId: space?.id,
    sort,
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
    scriptedCounts,
    viewerVotes: state.viewerVotes,
    spaces: visibleSpaces,
  });
}
