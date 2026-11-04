import {
  type CommentSort,
  type FeedAuthor,
  type FeedPost,
  type FeedSort,
  featureOn,
  type StudySettings,
  scriptedKarmaChange,
  startingKarmaFor,
} from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import {
  type AssembledFeed,
  assembleFeed,
  type FeedCandidate,
  type FeedSettings,
  feedSettingsFor,
} from "@truman3/feed";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
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
  | "title"
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
  karma?: number;
}

/** What the feed needs to name a space on a post. */
export type SpaceLabels = ReadonlyMap<
  string,
  { key: string; name: string; picture?: string | null | undefined }
>;

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
    ups: item.baseUps,
    downs: item.baseDowns,
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

/**
 * A participant's karma: where the study starts them, plus scripted changes so far, plus scripted
 * votes that have happened on what they've written. Their own votes don't count, and with a world per
 * person nobody else can vote.
 */
export async function participantKarma(
  db: Database,
  context: ParticipantContext,
  now = new Date(),
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(case ${schema.notifications.type} when 'up' then 1 else -1 end), 0)::int`,
    })
    .from(schema.notifications)
    .innerJoin(schema.content, eq(schema.content.id, schema.notifications.targetContentId))
    .where(
      and(
        eq(schema.notifications.worldId, context.worldId),
        eq(schema.content.authorActorId, context.actorId),
        inArray(schema.notifications.type, ["up", "down"]),
        lte(schema.notifications.dueAt, now),
      ),
    );
  const elapsedMs = now.getTime() - context.worldStartedAt.getTime();
  return (
    startingKarmaFor(context.settings, context.conditionKey) +
    scriptedKarmaChange(context.settings, context.conditionKey, null, elapsedMs) +
    (row?.total ?? 0)
  );
}

/** Someone in the cast's karma: what the study wrote, plus scripted changes so far. */
export function castKarma(
  settings: StudySettings,
  conditionKey: string,
  username: string,
  written: number | undefined,
  elapsedMs: number,
): number {
  return (written ?? 0) + scriptedKarmaChange(settings, conditionKey, username, elapsedMs);
}

/** What was on screen, for the record. A participant's username can identify them, so it's "viewer". */
export function karmaShownIn(posts: readonly FeedPost[]): Record<string, number> {
  const shown: Record<string, number> = {};
  const note = ({ author }: { author: FeedAuthor }) => {
    if (author.karma !== undefined) {
      shown[author.isViewer ? "viewer" : author.username] = author.karma;
    }
  };
  for (const post of posts) {
    note(post);
    post.comments.forEach(note);
  }
  return shown;
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
  commentsHere = true,
  karma,
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
  /** False in a list that leaves comments for each post's own page. */
  commentsHere?: boolean;
  /** On a platform with karma, the viewer's own, and how to work out anyone else's. */
  karma?: { viewer: number; cast: (username: string, written?: number) => number } | undefined;
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
      ...(karma
        ? {
            karma:
              actor.id === viewerActorId ? karma.viewer : karma.cast(actor.username, profile.karma),
          }
        : {}),
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
      ...(item.title ? { title: item.title } : {}),
      // Only these, since whatever else a space holds has no reason to reach a browser.
      ...(space
        ? {
            space: {
              key: space.key,
              name: space.name,
              ...(space.picture ? { pictureUrl: mediaUrl(space.picture, mediaPublicUrl) } : {}),
            },
          }
        : {}),
      attachments: item.attachments.map(({ type, key }) => ({
        type,
        url: mediaUrl(key, mediaPublicUrl),
      })),
      comments: (commentsHere ? post.commentIds : []).map((id) => ({
        ...common(byId.get(id) as FeedContent),
        depth: post.commentDepths[id] ?? 0,
      })),
      commentCount: post.commentIds.length,
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
  /** An order this person chose and it was recorded, where the study allows it. */
  sort?: FeedSort | undefined;
  /** Only this post, on its own page. */
  post?: string | undefined;
  /** An order for comments this person chose and it was recorded, where the study allows it. */
  commentSort?: CommentSort | undefined;
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
    post,
    commentSort,
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
    // A profile shows what they've written, wherever it is, and a post's own page shows that post.
    // A home feed shows what someone joined, and always their own posts, so writing one in a space
    // they aren't in doesn't seem to lose it.
    return (
      found !== undefined &&
      (authorActorId !== undefined ||
        post !== undefined ||
        found.joined ||
        postOf(row).authorActorId === context.actorId)
    );
  };
  const inScope = (row: ContentRow) =>
    (!authorActorId || postOf(row).authorActorId === authorActorId) &&
    (!post || postOf(row).id === post) &&
    inSpaces(row);

  const conditionSettings = settings ?? feedSettingsFor(context.settings, context.conditionKey);
  const feedSettings: FeedSettings = {
    ...conditionSettings,
    ranker: sort ?? (space ? conditionSettings.spaceRanker : undefined) ?? conditionSettings.ranker,
    commentOrder: commentSort ?? conditionSettings.commentOrder,
  };
  // Comments that wait for a post's own page aren't shown here, so they aren't recorded as shown.
  const commentsHere =
    post !== undefined || !featureOn(context.settings, context.conditionKey, "postPages");
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
  const votesOf = (row: ContentRow) => {
    const vote = state.viewerVotes.get(row.id);
    const ups = row.baseUps + (scriptedCounts.get(`up:${row.id}`) ?? 0) + (vote === "up" ? 1 : 0);
    const downs =
      row.baseDowns + (scriptedCounts.get(`down:${row.id}`) ?? 0) + (vote === "down" ? 1 : 0);
    return { ups, downs, score: ups - downs };
  };

  const feed = assembleFeed(
    shownOnThisPlatform(rows.filter(inScope), context.settings, context.conditionKey).map(
      (row) => ({
        ...toCandidate(row, worldStartMs),
        ...votesOf(row),
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

  const karmaOn = featureOn(context.settings, context.conditionKey, "karma");
  const elapsedMs = now.getTime() - worldStartMs;

  const shaped = await shapeFeedPosts({
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
    commentsHere,
    karma: karmaOn
      ? {
          viewer: await participantKarma(db, context, now),
          cast: (username, written) =>
            castKarma(context.settings, context.conditionKey, username, written, elapsedMs),
        }
      : undefined,
  });

  await db.insert(schema.feedImpressions).values({
    worldId: context.worldId,
    viewerActorId: context.actorId,
    conditionId: context.conditionId,
    surface,
    spaceId: space?.id,
    sort,
    ranker: feed.ranker,
    rankerVersion: feed.rankerVersion,
    commentOrder: feed.commentOrder,
    commentOrderVersion: feed.commentOrderVersion,
    commentSort,
    seed: feed.seed,
    shownAt: now,
    karmaShown: karmaOn ? karmaShownIn(shaped) : null,
    items: feed.posts.map((post, index) => ({
      contentId: post.id,
      position: index,
      pinned: post.pinned,
      commentIds: commentsHere ? post.commentIds : [],
      ...(post.score === undefined ? {} : { score: post.score }),
    })),
  });

  return shaped;
}
