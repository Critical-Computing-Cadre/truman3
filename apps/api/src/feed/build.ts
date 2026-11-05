import {
  type CommentSort,
  type FeatureSet,
  type FeedAuthor,
  type FeedOriginal,
  type FeedPoll,
  type FeedPost,
  type FeedRemoved,
  type FeedSort,
  type Flair,
  featureOn,
  featuresFor,
  linkDomain,
  type PostTag,
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
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
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
  | "linkUrl"
  | "pinnedOn"
  | "locked"
  | "tags"
  | "poll"
  | "flair"
  | "crosspostOf"
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
  spaceFlair?: Record<string, string>;
}

/** What the feed needs to name a space on a post. */
export type SpaceLabels = ReadonlyMap<
  string,
  {
    key: string;
    name: string;
    picture?: string | null | undefined;
    postFlair?: readonly Flair[] | undefined;
    userFlair?: readonly Flair[] | undefined;
  }
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
  const chose = new Map(choices.map((choice) => [choice.spaceId, choice]));
  return rows
    .filter(
      ({ conditions }) => conditions.length === 0 || conditions.includes(context.conditionKey),
    )
    .map((space) => ({
      ...space,
      joined: chose.get(space.id)?.joined ?? space.startsJoined,
      flair: chose.get(space.id)?.flair ?? null,
    }));
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

/** Who took something down, and what they said. */
export interface Removal {
  actorId: string;
  reason: string | null;
  /** When it came due. */
  at: Date;
}

/**
 * What a moderator has taken down so far for this person, by content ID: scripted removals of what
 * the study wrote, and scripted reactions to what they wrote. Nothing has to run later, since this
 * only counts what has come due. If there are several for one thing, the first stands.
 */
export async function loadRemovals(
  db: Database,
  context: ParticipantContext,
  now: Date,
): Promise<Map<string, Removal>> {
  const removals = new Map<string, Removal>();
  if (!featureOn(context.settings, context.conditionKey, "removal")) {
    return removals;
  }
  const elapsedMs = now.getTime() - context.worldStartedAt.getTime();
  const scripted = await db
    .select()
    .from(schema.scriptedRemovals)
    .where(
      and(
        eq(schema.scriptedRemovals.studyVersionId, context.studyVersionId),
        lte(schema.scriptedRemovals.offsetMs, elapsedMs),
      ),
    )
    .orderBy(asc(schema.scriptedRemovals.offsetMs));
  for (const { contentId, actorId, reason, conditions, offsetMs } of scripted) {
    const applies = conditions.length === 0 || conditions.includes(context.conditionKey);
    if (applies && !removals.has(contentId)) {
      const at = new Date(context.worldStartedAt.getTime() + offsetMs);
      removals.set(contentId, { actorId, reason, at });
    }
  }
  const reactions = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.worldId, context.worldId),
        inArray(schema.notifications.type, ["remove", "restore"]),
        lte(schema.notifications.dueAt, now),
      ),
    )
    .orderBy(asc(schema.notifications.dueAt));
  for (const { type, targetContentId, actorId, reason, dueAt } of reactions) {
    // An appeal can put back what a moderator removed.
    if (type === "restore" && targetContentId) {
      removals.delete(targetContentId);
    } else if (targetContentId && !removals.has(targetContentId)) {
      removals.set(targetContentId, { actorId, reason, at: dueAt });
    }
  }
  return removals;
}

/** Someone in the cast a moderator has banned. Without a space, it's from everywhere. */
export interface Ban {
  bannedActorId: string;
  actorId: string;
  reason: string | null;
  spaceId: string | null;
  at: Date;
}

/**
 * Who a moderator has banned by this time, as this person's world has it: scripted bans, and ones
 * from answering this person's report. As with removals, nothing has to run later.
 */
export async function loadBans(
  db: Pick<Database, "select">,
  context: ParticipantContext,
  now: Date,
): Promise<Ban[]> {
  if (!featureOn(context.settings, context.conditionKey, "bans")) {
    return [];
  }
  const startMs = context.worldStartedAt.getTime();
  const scripted = await db
    .select()
    .from(schema.scriptedBans)
    .where(
      and(
        eq(schema.scriptedBans.studyVersionId, context.studyVersionId),
        lte(schema.scriptedBans.offsetMs, now.getTime() - startMs),
      ),
    );
  const answered = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.worldId, context.worldId),
        eq(schema.notifications.type, "ban"),
        lte(schema.notifications.dueAt, now),
      ),
    );
  return [
    ...scripted
      .filter(
        ({ conditions }) => conditions.length === 0 || conditions.includes(context.conditionKey),
      )
      .map(({ bannedActorId, actorId, reason, spaceId, offsetMs }) => ({
        bannedActorId,
        actorId,
        reason,
        spaceId,
        at: new Date(startMs + offsetMs),
      })),
    ...answered.map(({ targetActorId, actorId, reason, dueAt }) => ({
      bannedActorId: targetActorId as string,
      actorId,
      reason,
      spaceId: null,
      at: dueAt,
    })),
  ];
}

/** Whether a ban stops this person from doing something at this time, in this space. */
export function bannedAt(
  bans: readonly Ban[],
  actorId: string,
  spaceId: string | null | undefined,
  atMs: number,
): boolean {
  return bans.some(
    (ban) =>
      ban.bannedActorId === actorId &&
      ban.at.getTime() <= atMs &&
      (ban.spaceId === null || ban.spaceId === spaceId),
  );
}

/**
 * Whether this was written after its author's ban, so it never appears. So does anything under it,
 * since a reply can't show without what it replies to. What they wrote before stays.
 */
export function hiddenByBan<T extends FeedContent>(
  row: T,
  rowsById: ReadonlyMap<string, T>,
  bans: readonly Ban[],
  worldStartMs: number,
): boolean {
  if (bans.length === 0) {
    return false;
  }
  const chain: T[] = [row];
  for (let above = row; above.parentId && chain.length <= rowsById.size; ) {
    const parent = rowsById.get(above.parentId);
    if (!parent) {
      break;
    }
    chain.push(parent);
    above = parent;
  }
  const spaceId = (chain[chain.length - 1] as T).spaceId;
  return chain.some((item) =>
    bannedAt(bans, item.authorActorId, spaceId, contentTimeMs(item, worldStartMs)),
  );
}

/** What's waiting for a moderator's approval now. A hold's row comes due when it's decided. */
export async function loadHeldIds(
  db: Pick<Database, "select">,
  context: ParticipantContext,
  now: Date,
): Promise<Set<string>> {
  if (!featureOn(context.settings, context.conditionKey, "autoRules")) {
    return new Set();
  }
  const rows = await db
    .select({ contentId: schema.notifications.targetContentId })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.worldId, context.worldId),
        eq(schema.notifications.type, "hold"),
        gt(schema.notifications.dueAt, now),
      ),
    );
  return new Set(rows.flatMap(({ contentId }) => (contentId ? [contentId] : [])));
}

/** What this person has appealed. */
export async function loadAppealedIds(
  db: Pick<Database, "select">,
  context: ParticipantContext,
): Promise<Set<string>> {
  if (!featureOn(context.settings, context.conditionKey, "appeals")) {
    return new Set();
  }
  const rows = await db
    .select({ contentId: schema.events.targetContentId })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.worldId, context.worldId),
        eq(schema.events.participantId, context.participantId),
        eq(schema.events.type, "moderation.appealed"),
      ),
    );
  return new Set(rows.flatMap(({ contentId }) => (contentId ? [contentId] : [])));
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
    pollChoices: new Map(
      interactions.flatMap(({ kind, contentId, pollOption }) =>
        kind === "poll" && pollOption !== null ? [[contentId, pollOption] as const] : [],
      ),
    ),
    viewerVotes: new Map(
      interactions.flatMap(({ kind, contentId }) =>
        kind === "up" || kind === "down" ? [[contentId, kind] as const] : [],
      ),
    ),
    flaggedContentIds: idsOfKind("flag"),
    savedContentIds: idsOfKind("save"),
    hiddenContentIds: idsOfKind("hide"),
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
  features,
  savedContentIds = new Set(),
  hiddenContentIds = new Set(),
  viewerFlair = new Map(),
  pollChoices = new Map(),
  canSeeOriginal = () => true,
  removals = new Map(),
  bans = [],
  heldIds = new Set(),
  appealedIds = new Set(),
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
  /** Which features are on, since what they add to a post shouldn't reach a browser otherwise. */
  features: FeatureSet;
  savedContentIds?: ReadonlySet<string>;
  hiddenContentIds?: ReadonlySet<string>;
  /** The flair this viewer chose, by space. */
  viewerFlair?: ReadonlyMap<string, string>;
  /** Which option this viewer chose in each poll. */
  pollChoices?: ReadonlyMap<string, number>;
  /** Whether this viewer can see a post a crosspost came from, which may not be shown to them. */
  canSeeOriginal?: (row: FeedContent) => boolean;
  /** What a moderator has taken down so far, by content ID. */
  removals?: ReadonlyMap<string, Removal>;
  /** Who a moderator has banned so far. */
  bans?: readonly Ban[];
  /** What's waiting for a moderator's approval now. */
  heldIds?: ReadonlySet<string>;
  /** What this viewer has appealed. */
  appealedIds?: ReadonlySet<string>;
}): Promise<FeedPost[]> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const shownIds = feed.posts.flatMap((post) => [post.id, ...post.commentIds]);
  const shownOriginals = features.crossposting
    ? feed.posts.flatMap((post) => {
        const original = byId.get(byId.get(post.id)?.crosspostOf ?? "");
        return original && canSeeOriginal(original) ? [original] : [];
      })
    : [];
  const authorIds = [
    ...new Set([
      ...shownIds.map((id) => (byId.get(id) as FeedContent).authorActorId),
      ...shownOriginals.map(({ authorActorId }) => authorActorId),
      ...shownIds.flatMap((id) => {
        const removal = removals.get(id);
        return removal ? [removal.actorId] : [];
      }),
    ]),
  ];
  const authorById = await loadAuthors(authorIds);

  const pollFor = (item: FeedContent): FeedPoll | undefined => {
    if (!item.poll || !features.polls) {
      return undefined;
    }
    const voted = pollChoices.get(item.id) ?? null;
    const showCounts = voted !== null || item.poll.resultsFirst;
    return {
      voted,
      options: item.poll.options.map(({ text, votes }, index) => ({
        text,
        ...(showCounts ? { votes: votes + (voted === index ? 1 : 0) } : {}),
      })),
    };
  };

  const originalOf = (item: FeedContent): FeedOriginal | null => {
    const original = byId.get(item.crosspostOf ?? "");
    if (!original || !canSeeOriginal(original)) {
      return null;
    }
    const profile = (authorById.get(original.authorActorId) as FeedActor).profile as ActorProfile;
    const space = original.spaceId ? spaces.get(original.spaceId) : undefined;
    const picture = original.attachments[0];
    return {
      id: original.id,
      authorName: profile.name ?? (authorById.get(original.authorActorId) as FeedActor).username,
      body: original.body,
      ...(original.title && features.titles ? { title: original.title } : {}),
      ...(picture ? { imageUrl: mediaUrl(picture.key, mediaPublicUrl) } : {}),
      ...(original.linkUrl && features.links ? { linkDomain: linkDomain(original.linkUrl) } : {}),
      ...(space ? { space: { key: space.key, name: space.name } } : {}),
    };
  };

  const toAuthor = (actorId: string, spaceId?: string | null): FeedAuthor => {
    const actor = authorById.get(actorId) as FeedActor;
    const profile = actor.profile as ActorProfile;
    const space = spaceId && features.flair ? spaces.get(spaceId) : undefined;
    const flairText = space
      ? actor.id === viewerActorId
        ? (viewerFlair.get(spaceId as string) ?? profile.spaceFlair?.[space.key])
        : profile.spaceFlair?.[space.key]
      : undefined;
    const flair = flairText ? space?.userFlair?.find(({ text }) => text === flairText) : undefined;
    return {
      username: actor.username,
      name: profile.name ?? actor.username,
      pictureUrl: profile.picture ? mediaUrl(profile.picture, mediaPublicUrl) : null,
      isViewer: actor.id === viewerActorId,
      ...(profile.moderator ? { moderator: true as const } : {}),
      ...(bans.some(
        ({ bannedActorId, spaceId: from }) =>
          bannedActorId === actorId && (from === null || from === spaceId),
      )
        ? { banned: true as const }
        : {}),
      ...(flair ? { flair } : {}),
      ...(karma
        ? {
            karma:
              actor.id === viewerActorId ? karma.viewer : karma.cast(actor.username, profile.karma),
          }
        : {}),
    };
  };

  /** What a browser gets about a removal, and whether what was removed stays hidden from this viewer. */
  const removalOf = (item: FeedContent) => {
    const removal = removals.get(item.id);
    if (!removal) {
      return { removed: undefined, withheld: false };
    }
    const moderator = authorById.get(removal.actorId) as FeedActor;
    const removed: FeedRemoved = {
      by: (moderator.profile as ActorProfile).name ?? moderator.username,
      ...(removal.reason ? { reason: removal.reason } : {}),
      ...(features.appeals && item.authorActorId === viewerActorId
        ? { appeal: appealedIds.has(item.id) ? ("sent" as const) : ("open" as const) }
        : {}),
    };
    return { removed, withheld: item.authorActorId !== viewerActorId };
  };

  const common = (item: FeedContent, spaceId: string | null) => {
    const { removed, withheld } = removalOf(item);
    const liked = likedContentIds.has(item.id);
    const vote = viewerVotes.get(item.id) ?? null;
    const scripted = (type: string) => scriptedCounts.get(`${type}:${item.id}`) ?? 0;
    return {
      id: item.id,
      author: toAuthor(item.authorActorId, spaceId),
      body: withheld ? "" : item.body,
      at: new Date(contentTimeMs(item, worldStartMs)).toISOString(),
      likes: item.baseLikes + scripted("like") + (liked ? 1 : 0),
      liked,
      ups: item.baseUps + scripted("up") + (vote === "up" ? 1 : 0),
      downs: item.baseDowns + scripted("down") + (vote === "down" ? 1 : 0),
      vote,
      // A flag's cover and its button to undo it have no place on what's already gone.
      flagged: !removed && flaggedContentIds.has(item.id),
      ...(removed ? { removed } : {}),
      ...(heldIds.has(item.id) && !removed ? { held: true as const } : {}),
    };
  };

  return feed.posts.map((post) => {
    const item = byId.get(post.id) as FeedContent;
    const space = item.spaceId ? spaces.get(item.spaceId) : undefined;
    const { withheld } = removalOf(item);
    const comments = (commentsHere ? post.commentIds : []).map((id) => ({
      ...common(byId.get(id) as FeedContent, item.spaceId),
      depth: post.commentDepths[id] ?? 0,
    }));
    const place = {
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
      ...(post.studyPinned ? { pinned: true as const } : {}),
      ...(item.locked && features.locking ? { locked: true as const } : {}),
      ...(savedContentIds.has(item.id) ? { saved: true as const } : {}),
      ...(hiddenContentIds.has(item.id) ? { hidden: true as const } : {}),
    };
    // Nothing of what it said reaches someone who isn't its author, including what covered it.
    if (withheld) {
      return {
        ...common(item, item.spaceId),
        ...place,
        attachments: [],
        comments,
        commentCount: post.commentIds.length,
      };
    }
    const original = features.crossposting ? originalOf(item) : null;
    // A crosspost shows its original, so whatever covers that has to cover this too.
    const tags = [
      ...new Set([...item.tags, ...(original ? (byId.get(original.id)?.tags ?? []) : [])]),
    ].filter(
      (tag) => (tag === "spoiler" && features.spoilers) || (tag === "adult" && features.adultTags),
    ) as PostTag[];
    const poll = pollFor(item);
    const flair =
      item.flair && features.flair
        ? space?.postFlair?.find(({ text }) => text === item.flair)
        : undefined;
    return {
      ...common(item, item.spaceId),
      ...(poll ? { poll } : {}),
      ...(flair ? { flair } : {}),
      ...(item.crosspostOf && features.crossposting ? { crosspost: { original } } : {}),
      ...(item.title ? { title: item.title } : {}),
      ...(item.linkUrl && features.links
        ? { link: { url: item.linkUrl, domain: linkDomain(item.linkUrl) } }
        : {}),
      ...place,
      ...(tags.length > 0 ? { tags } : {}),
      attachments: item.attachments.map(({ type, key }) => ({
        type,
        url: mediaUrl(key, mediaPublicUrl),
      })),
      comments,
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
  /** Only what this person has saved or hidden, as on their profile. */
  list?: "saved" | "hidden" | undefined;
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
    list,
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
        list !== undefined ||
        found.joined ||
        postOf(row).authorActorId === context.actorId)
    );
  };
  const features = featuresFor(context.settings, context.conditionKey);
  const hiddenHere = features.hiding ? state.hiddenContentIds : new Set<string>();
  const listed = list === "saved" ? state.savedContentIds : state.hiddenContentIds;
  const bans = await loadBans(db, context, now);
  const inScope = (row: ContentRow) =>
    !hiddenByBan(row, rowsById, bans, worldStartMs) &&
    (!authorActorId || postOf(row).authorActorId === authorActorId) &&
    (!post || postOf(row).id === post) &&
    (list ? listed.has(postOf(row).id) : post !== undefined || !hiddenHere.has(postOf(row).id)) &&
    inSpaces(row);
  // A pin belongs to a list, so a post pinned in its community isn't also on top at home.
  const pinPlace =
    features.pinning && !post && !authorActorId && !list ? (space ? "space" : "home") : null;

  const conditionSettings = settings ?? feedSettingsFor(context.settings, context.conditionKey);
  const feedSettings: FeedSettings = {
    ...conditionSettings,
    ranker:
      sort ??
      (list ? "new" : undefined) ??
      (space ? conditionSettings.spaceRanker : undefined) ??
      conditionSettings.ranker,
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
    .select({
      type: schema.notifications.type,
      contentId: schema.notifications.targetContentId,
      actorId: schema.notifications.actorId,
      dueAt: schema.notifications.dueAt,
    })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.worldId, context.worldId),
        inArray(schema.notifications.type, ["like", "up", "down"]),
        lte(schema.notifications.dueAt, now),
      ),
    );
  const scriptedCounts = new Map<string, number>();
  for (const { type, contentId, actorId, dueAt } of dueReactions) {
    const target = rowsById.get(contentId as string);
    // Someone banned stops reacting too, even if that was already on its way.
    if (target && bannedAt(bans, actorId, postOf(target).spaceId, dueAt.getTime())) {
      continue;
    }
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
        studyPinned: pinPlace !== null && row.pinnedOn.includes(pinPlace),
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
  const removals = await loadRemovals(db, context, now);

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
    features,
    savedContentIds: features.saving ? state.savedContentIds : new Set(),
    hiddenContentIds: features.hiding ? state.hiddenContentIds : new Set(),
    pollChoices: state.pollChoices,
    viewerFlair: new Map(spaces.flatMap(({ id, flair }) => (flair ? [[id, flair]] : []))),
    canSeeOriginal: (row) => {
      const inCondition =
        row.conditions.length === 0 || row.conditions.includes(context.conditionKey);
      const appeared = contentTimeMs(row, worldStartMs) <= now.getTime();
      const inVisibleSpace = !spacesOn || !row.spaceId || visibleSpaces.has(row.spaceId);
      const removed =
        (feedSettings.removeBlocked && state.blockedActorIds.has(row.authorActorId)) ||
        (feedSettings.removeFlagged && state.flaggedContentIds.has(row.id));
      return (
        inCondition &&
        appeared &&
        inVisibleSpace &&
        !removed &&
        !removals.has(row.id) &&
        !hiddenByBan(row, rowsById, bans, worldStartMs)
      );
    },
    removals,
    bans,
    heldIds: await loadHeldIds(db, context, now),
    appealedIds: await loadAppealedIds(db, context),
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
      // What was on screen in place of it, since a removal depends on the moment and the person.
      ...(removals.has(post.id) ? { removed: true } : {}),
      ...(commentsHere && post.commentIds.some((id) => removals.has(id))
        ? { removedCommentIds: post.commentIds.filter((id) => removals.has(id)) }
        : {}),
    })),
  });

  return shaped;
}
