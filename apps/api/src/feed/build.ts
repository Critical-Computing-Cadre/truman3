import {
  type CommentSort,
  type FeatureSet,
  type FeedAuthor,
  type FeedLabel,
  type FeedOriginal,
  type FeedPoll,
  type FeedPost,
  type FeedRemoved,
  type FeedSort,
  type Flair,
  featureOn,
  featuresFor,
  hasHashtag,
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
  placeAds,
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
  | "repostOf"
  | "quoteOf"
  | "baseReposts"
  | "baseQuotes"
  | "adLabel"
  | "likedByActorId"
  | "place"
  | "taggedActorIds"
  | "tagsParticipant"
  | "baseViews"
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
  followers?: number;
  following?: number;
  badge?: string;
  suggested?: boolean;
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
 * The URL of someone's picture, as this condition shows it. A study can give someone in the cast a
 * different picture in some conditions, such as one with a frame (ADR 63).
 */
export function pictureUrlOf(
  profile: { picture?: string | undefined; conditionPictures?: Record<string, string> | undefined },
  conditionKey: string,
  publicUrl: string,
): string | null {
  const key = profile.conditionPictures?.[conditionKey] ?? profile.picture;
  return key ? mediaUrl(key, publicUrl) : null;
}

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
  now: Date,
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

/** A moderator's label on something, such as "Spam". */
export interface Label {
  text: string;
  actorId: string;
  hides: boolean;
  reason: string | null;
  /** Whether it says who gave it. */
  showsWho?: boolean;
  /** A yes-or-no question it asks, until this person has answered it. */
  ask?: string | null;
  /** When it came due. */
  at: Date;
}

/**
 * What moderators have labeled so far for this person, by content ID: scripted labels on what the
 * study wrote, and scripted reactions to what they wrote, which never hide it from them. As with
 * removals, nothing has to run later. An appeal that puts something back takes its labels off.
 */
export async function loadLabels(
  db: Pick<Database, "select">,
  context: ParticipantContext,
  now: Date,
): Promise<Map<string, Label[]>> {
  const labels = new Map<string, Label[]>();
  if (!featureOn(context.settings, context.conditionKey, "labels")) {
    return labels;
  }
  const add = (contentId: string, label: Label) =>
    labels.set(contentId, [...(labels.get(contentId) ?? []), label]);
  const startMs = context.worldStartedAt.getTime();
  const scripted = await db
    .select()
    .from(schema.scriptedLabels)
    .where(
      and(
        eq(schema.scriptedLabels.studyVersionId, context.studyVersionId),
        lte(schema.scriptedLabels.offsetMs, now.getTime() - startMs),
      ),
    )
    .orderBy(asc(schema.scriptedLabels.offsetMs), asc(schema.scriptedLabels.id));
  // A question is asked until they answer it.
  const answered = scripted.some(({ ask }) => ask)
    ? new Set(
        (
          await db
            .select({
              contentId: schema.events.targetContentId,
              label: sql<string>`${schema.events.payload}->>'label'`,
            })
            .from(schema.events)
            .where(
              and(
                eq(schema.events.worldId, context.worldId),
                eq(schema.events.type, "content.label_answered"),
              ),
            )
        ).map(({ contentId, label }) => `${contentId}:${label}`),
      )
    : new Set<string>();
  for (const row of scripted) {
    if (row.conditions.length === 0 || row.conditions.includes(context.conditionKey)) {
      add(row.contentId, {
        text: row.label,
        actorId: row.actorId,
        hides: row.hides,
        reason: row.reason,
        showsWho: row.showsWho,
        ask: row.ask && !answered.has(`${row.contentId}:${row.label}`) ? row.ask : null,
        at: new Date(startMs + row.offsetMs),
      });
    }
  }
  const reactions = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.worldId, context.worldId),
        inArray(schema.notifications.type, ["label", "restore"]),
        lte(schema.notifications.dueAt, now),
      ),
    )
    .orderBy(asc(schema.notifications.dueAt));
  for (const { type, targetContentId, actorId, reason, dueAt } of reactions) {
    if (!targetContentId) {
      continue;
    }
    if (type === "restore") {
      labels.delete(targetContentId);
    } else {
      add(targetContentId, { text: reason ?? "", actorId, hides: false, reason: null, at: dueAt });
    }
  }
  return labels;
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

/** A context note, as written, with what's known about it for this person. */
export interface ShownNote {
  ref: string;
  body: string;
  helpful: number;
  notHelpful: number;
  rating: "helpful" | "not_helpful" | null;
}

/** The note showing on each post by now. If a post has several, the first to come due stands. */
export async function loadContextNotes(
  db: Pick<Database, "select">,
  context: ParticipantContext,
  now: Date,
  ratings: ReadonlyMap<string, "helpful" | "not_helpful">,
): Promise<Map<string, ShownNote>> {
  const notes = new Map<string, ShownNote>();
  if (!featureOn(context.settings, context.conditionKey, "contextNotes")) {
    return notes;
  }
  const rows = await db
    .select()
    .from(schema.scriptedContextNotes)
    .where(
      and(
        eq(schema.scriptedContextNotes.studyVersionId, context.studyVersionId),
        lte(schema.scriptedContextNotes.offsetMs, now.getTime() - context.worldStartedAt.getTime()),
      ),
    )
    .orderBy(asc(schema.scriptedContextNotes.offsetMs));
  for (const row of rows) {
    const applies = row.conditions.length === 0 || row.conditions.includes(context.conditionKey);
    if (applies && !notes.has(row.contentId)) {
      const rating = ratings.get(row.contentId) ?? null;
      notes.set(row.contentId, {
        ref: row.ref,
        body: row.body,
        helpful: row.baseHelpful + (rating === "helpful" ? 1 : 0),
        notHelpful: row.baseNotHelpful + (rating === "not_helpful" ? 1 : 0),
        rating,
      });
    }
  }
  return notes;
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
  const relations = await db
    .select({
      targetActorId: schema.actorRelations.targetActorId,
      kind: schema.actorRelations.kind,
    })
    .from(schema.actorRelations)
    .where(
      and(
        eq(schema.actorRelations.worldId, context.worldId),
        eq(schema.actorRelations.actorId, context.actorId),
      ),
    );
  const related = (kind: string) =>
    new Set(relations.filter((row) => row.kind === kind).map((row) => row.targetActorId));

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
    mutedThreadIds: idsOfKind("mute_thread"),
    hiddenContentIds: idsOfKind("hide"),
    viewedContentIds: idsOfKind("view"),
    blockedActorIds: related("block"),
    followedActorIds: related("follow"),
    mutedActorIds: related("mute"),
    noteRatings: new Map<string, "helpful" | "not_helpful">(
      interactions.flatMap(({ kind, contentId }): [string, "helpful" | "not_helpful"][] =>
        kind === "note_helpful"
          ? [[contentId, "helpful"]]
          : kind === "note_not_helpful"
            ? [[contentId, "not_helpful"]]
            : [],
      ),
    ),
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
  mutedThreadIds = new Set(),
  viewerFlair = new Map(),
  pollChoices = new Map(),
  canSeeOriginal = () => true,
  removals = new Map(),
  labels = new Map(),
  bans = [],
  heldIds = new Set(),
  appealedIds = new Set(),
  countable = () => true,
  repostsAsThemselves = false,
  contextNotes = new Map(),
  viewedContentIds = new Set(),
  conditionKey,
}: {
  loadAuthors: (ids: string[]) => Promise<ReadonlyMap<string, FeedActor>>;
  mediaPublicUrl: string;
  /** The condition it's shown in, which can change pictures. */
  conditionKey: string;
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
  /** Posts this person stopped notifications about. */
  mutedThreadIds?: ReadonlySet<string>;
  /** The flair this viewer chose, by space. */
  viewerFlair?: ReadonlyMap<string, string>;
  /** Which option this viewer chose in each poll. */
  pollChoices?: ReadonlyMap<string, number>;
  /** Whether this viewer can see a post a crosspost came from, which may not be shown to them. */
  canSeeOriginal?: (row: FeedContent) => boolean;
  /** What a moderator has taken down so far, by content ID. */
  removals?: ReadonlyMap<string, Removal>;
  /** What moderators have labeled so far, by content ID. */
  labels?: ReadonlyMap<string, readonly Label[]>;
  /** Who a moderator has banned so far. */
  bans?: readonly Ban[];
  /** What's waiting for a moderator's approval now. */
  heldIds?: ReadonlySet<string>;
  /** What this viewer has appealed. */
  appealedIds?: ReadonlySet<string>;
  /** Whether a repost, quote, or comment is there to be counted for this viewer by now. */
  countable?: (row: FeedContent) => boolean;
  /** Shows a repost as its own card, so a researcher can edit it, rather than as the post it passes on. */
  repostsAsThemselves?: boolean;
  /** The note showing on each post by now. */
  contextNotes?: ReadonlyMap<string, ShownNote>;
  /** What this viewer has seen, which counts toward what a post says it has. */
  viewedContentIds?: ReadonlySet<string>;
}): Promise<FeedPost[]> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  /** The first post in a chain of reposts. */
  const rootOf = (row: FeedContent) => {
    let current = row;
    for (let step = 0; current.repostOf && step < rows.length; step++) {
      current = byId.get(current.repostOf) ?? current;
    }
    return current;
  };
  const passesAlong = (row: FeedContent) =>
    Boolean(row.repostOf && features.reposts && !repostsAsThemselves);
  const shownAs = (row: FeedContent) => (passesAlong(row) ? rootOf(row) : row);
  /** What this shows inside itself: what it was crossposted from, or quotes. */
  const insideOf = (item: FeedContent) => [
    ...(features.crossposting && item.crosspostOf ? [item.crosspostOf] : []),
    ...(features.quotes && item.quoteOf ? [item.quoteOf] : []),
    ...(repostsAsThemselves && item.repostOf ? [item.repostOf] : []),
  ];
  const shownIds = feed.posts.flatMap((post) => [post.id, ...post.commentIds]);
  const shownOriginals = feed.posts.flatMap((post) =>
    insideOf(shownAs(byId.get(post.id) as FeedContent)).flatMap((id) => {
      const original = byId.get(id);
      return original && canSeeOriginal(original) ? [original] : [];
    }),
  );
  const authorIds = [
    ...new Set([
      ...shownIds.map((id) => (byId.get(id) as FeedContent).authorActorId),
      ...feed.posts.flatMap((post) => {
        const shown = shownAs(byId.get(post.id) as FeedContent);
        return shown.likedByActorId && features.likes ? [shown.likedByActorId] : [];
      }),
      ...(features.photoTags
        ? feed.posts.flatMap((post) => {
            const shown = shownAs(byId.get(post.id) as FeedContent);
            return [...shown.taggedActorIds, ...(shown.tagsParticipant ? [viewerActorId] : [])];
          })
        : []),
      ...feed.posts.flatMap((post) => {
        const listed = byId.get(post.id) as FeedContent;
        const above = listed.repostOf ? byId.get(listed.repostOf) : undefined;
        return [shownAs(listed).authorActorId, ...(above ? [above.authorActorId] : [])];
      }),
      ...shownOriginals.map(({ authorActorId }) => authorActorId),
      ...shownIds.flatMap((id) => {
        const removal = removals.get(id);
        return removal ? [removal.actorId] : [];
      }),
      ...shownIds.flatMap((id) => (labels.get(id) ?? []).map(({ actorId }) => actorId)),
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

  const originalOf = (id: string | null): FeedOriginal | null => {
    const original = byId.get(id ?? "");
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
      pictureUrl: pictureUrlOf(profile, conditionKey, mediaPublicUrl),
      isViewer: actor.id === viewerActorId,
      ...(profile.moderator ? { moderator: true as const } : {}),
      ...(profile.badge && features.badges ? { badge: profile.badge } : {}),
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

  /** What a browser gets about labels. A removal says more, so it takes their place. */
  const labelsOf = (item: FeedContent): FeedLabel[] => {
    const own = item.authorActorId === viewerActorId;
    return removals.has(item.id)
      ? []
      : (labels.get(item.id) ?? []).map((label) => {
          const moderator = authorById.get(label.actorId) as FeedActor;
          return {
            text: label.text,
            by:
              label.showsWho === false
                ? ""
                : ((moderator.profile as ActorProfile).name ?? moderator.username),
            hides: label.hides && !own,
            ...(label.reason ? { reason: label.reason } : {}),
            ...(label.ask && !own ? { ask: label.ask } : {}),
            ...(features.appeals && own
              ? { appeal: appealedIds.has(item.id) ? ("sent" as const) : ("open" as const) }
              : {}),
          };
        });
  };

  const common = (item: FeedContent, spaceId: string | null) => {
    const { removed, withheld } = removalOf(item);
    const labeled = labelsOf(item);
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
      ...(labeled.length > 0 ? { labels: labeled } : {}),
      ...(heldIds.has(item.id) && !removed ? { held: true as const } : {}),
    };
  };

  // What's been passed along or quoted, counted once for each first post.
  const reposters = new Map<string, number>();
  const quoters = new Map<string, number>();
  const commentCounts = new Map<string, number>();
  let viewerReposted = new Set<string>();
  if (features.reposts || features.quotes) {
    const mine = new Set<string>();
    for (const row of rows) {
      if (!countable(row)) {
        continue;
      }
      if (row.repostOf) {
        const root = rootOf(row).id;
        reposters.set(root, (reposters.get(root) ?? 0) + 1);
        if (row.authorActorId === viewerActorId) {
          mine.add(root);
        }
      }
      if (row.quoteOf) {
        quoters.set(row.quoteOf, (quoters.get(row.quoteOf) ?? 0) + 1);
      }
      if (row.parentId) {
        let top = row;
        for (let step = 0; top.parentId && step < rows.length; step++) {
          top = byId.get(top.parentId) ?? top;
        }
        commentCounts.set(top.id, (commentCounts.get(top.id) ?? 0) + 1);
      }
    }
    viewerReposted = mine;
  }

  return feed.posts.map((post) => {
    const listed = byId.get(post.id) as FeedContent;
    const item = shownAs(listed);
    const repostedBy = passesAlong(listed)
      ? (() => {
          const person = authorById.get(listed.authorActorId) as FeedActor;
          const above = byId.get(listed.repostOf as string);
          const from = above?.repostOf ? authorById.get(above.authorActorId) : undefined;
          return {
            repostedBy: {
              id: listed.id,
              name: (person.profile as ActorProfile).name ?? person.username,
              username: person.username,
              isViewer: person.id === viewerActorId,
              ...(from ? { via: (from.profile as ActorProfile).name ?? from.username } : {}),
            },
          };
        })()
      : {};
    const note = contextNotes.get(item.id);
    const passing = {
      ...repostedBy,
      ...(item.adLabel && features.ads ? { ad: item.adLabel } : {}),
      ...(item.likedByActorId && features.likes && authorById.has(item.likedByActorId)
        ? {
            likedBy:
              ((authorById.get(item.likedByActorId) as FeedActor).profile as ActorProfile).name ??
              (authorById.get(item.likedByActorId) as FeedActor).username,
          }
        : {}),
      ...(item.place && features.places && !removals.has(item.id) ? { place: item.place } : {}),
      ...(features.photoTags &&
      (item.taggedActorIds.length > 0 || item.tagsParticipant) &&
      !removals.has(item.id)
        ? {
            // A study's tag of the participant names whoever is looking, after the cast it tags.
            tagged: [
              ...item.taggedActorIds,
              ...(item.tagsParticipant ? [viewerActorId] : []),
            ].flatMap((id) => {
              const person = authorById.get(id);
              return person
                ? [
                    {
                      username: person.username,
                      name: (person.profile as ActorProfile).name ?? person.username,
                      ...(id === viewerActorId ? { isViewer: true } : {}),
                    },
                  ]
                : [];
            }),
          }
        : {}),
      ...(features.viewCounts
        ? { viewCount: item.baseViews + (viewedContentIds.has(item.id) ? 1 : 0) }
        : {}),
      ...(note && !removals.has(item.id)
        ? {
            contextNote: {
              body: note.body,
              helpful: note.helpful,
              notHelpful: note.notHelpful,
              rating: note.rating,
            },
          }
        : {}),
      ...(features.reposts
        ? {
            repostCount: item.baseReposts + (reposters.get(item.id) ?? 0),
            ...(viewerReposted.has(item.id) ? { reposted: true as const } : {}),
          }
        : {}),
      ...(features.quotes ? { quoteCount: item.baseQuotes + (quoters.get(item.id) ?? 0) } : {}),
    };
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
      ...(mutedThreadIds.has(item.id) ? { threadMuted: true as const } : {}),
      ...(hiddenContentIds.has(item.id) ? { hidden: true as const } : {}),
    };
    // Nothing of what it said reaches someone who isn't its author, including what covered it.
    if (withheld) {
      return {
        ...common(item, item.spaceId),
        ...place,
        ...passing,
        attachments: [],
        comments,
        commentCount: passesAlong(listed)
          ? (commentCounts.get(item.id) ?? 0)
          : post.commentIds.length,
      };
    }
    const original = features.crossposting ? originalOf(item.crosspostOf) : null;
    const quotedId = item.quoteOf ?? (repostsAsThemselves ? item.repostOf : null);
    const quoted = features.quotes || repostsAsThemselves ? originalOf(quotedId) : null;
    // A crosspost shows its original, so whatever covers that has to cover this too.
    const tags = [
      ...new Set([
        ...item.tags,
        ...(original ? (byId.get(original.id)?.tags ?? []) : []),
        ...(quoted ? (byId.get(quoted.id)?.tags ?? []) : []),
      ]),
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
      ...(quotedId && (features.quotes || repostsAsThemselves)
        ? { quote: { original: quoted } }
        : {}),
      ...passing,
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
      commentCount: passesAlong(listed)
        ? (commentCounts.get(item.id) ?? 0)
        : post.commentIds.length,
    };
  });
}

export interface BuildFeedOptions {
  now: Date;
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
  /** Only those this person follows, and themselves, on that tab. */
  following?: boolean | undefined;
  /** Only posts with this hashtag, on its page. */
  tag?: string | undefined;
  /** Only posts at this place, on its page. */
  place?: string | undefined;
  /** Only posts this actor is tagged in, on their profile's Tagged tab. */
  taggedActorId?: string | undefined;
  /** Only photo posts from people this person doesn't follow, for the Explore grid. */
  explore?: boolean | undefined;
  /** Only posts this actor replied to, with only their replies, on their profile's Replies tab. */
  repliedBy?: string | undefined;
}

/** Works out what a participant sees now, and records that it was shown. */
export async function buildFeed(
  { db, mediaPublicUrl }: FeedDependencies,
  context: ParticipantContext,
  {
    now,
    surface = "feed",
    authorActorId,
    settings,
    visit,
    space,
    sort,
    post,
    commentSort,
    list,
    following,
    tag,
    place,
    taggedActorId,
    explore,
    repliedBy,
  }: BuildFeedOptions,
): Promise<FeedPost[]> {
  const worldStartMs = context.worldStartedAt.getTime();

  // Stories are content too, but they have their own row across the top, not a place in lists.
  // Messages are private, on their own page.
  const rows = (
    await db
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
      )
  ).filter(({ kind }) => kind !== "story" && kind !== "message");

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
  const conditionSettings = settings ?? feedSettingsFor(context.settings, context.conditionKey);
  const featureSettings = conditionSettings;
  const hiddenHere = features.hiding ? state.hiddenContentIds : new Set<string>();
  const listed = list === "saved" ? state.savedContentIds : state.hiddenContentIds;
  const bans = await loadBans(db, context, now);
  const rootOf = (row: ContentRow) => {
    let current = row;
    for (let step = 0; current.repostOf && step < rows.length; step++) {
      current = rowsById.get(current.repostOf) ?? current;
    }
    return current;
  };
  const inCondition = (row: ContentRow) =>
    row.conditions.length === 0 || row.conditions.includes(context.conditionKey);
  const appeared = (row: ContentRow) => contentTimeMs(row, worldStartMs) <= now.getTime();
  const notTakenAway = (row: ContentRow) =>
    !hiddenByBan(row, rowsById, bans, worldStartMs) &&
    !(featureSettings.removeBlocked && state.blockedActorIds.has(row.authorActorId)) &&
    !(featureSettings.removeFlagged && state.flaggedContentIds.has(row.id));
  /** A repost only shows if the post it passes along could. */
  const repostShows = (row: ContentRow) => {
    if (!row.repostOf) {
      return true;
    }
    const root = rootOf(row);
    return (
      features.reposts &&
      inCondition(root) &&
      appeared(root) &&
      notTakenAway(root) &&
      !state.flaggedContentIds.has(root.id) &&
      !state.blockedActorIds.has(root.authorActorId) &&
      !hiddenHere.has(root.id)
    );
  };
  /** On Explore: someone else's photo, not an ad or a repost, from someone they don't follow. */
  const discoverable = (row: ContentRow) =>
    row.attachments.length > 0 &&
    !row.adLabel &&
    !row.repostOf &&
    row.authorActorId !== context.actorId &&
    !state.followedActorIds.has(row.authorActorId);
  /** Someone muted is left out of lists and threads, though their own page and posts still open. */
  const mutedAway = (row: ContentRow) => {
    if (state.mutedActorIds.size === 0 || authorActorId) {
      return false;
    }
    for (let current: ContentRow | undefined = row; current; ) {
      const isTheOpenPost = post !== undefined && current.id === post;
      if (!isTheOpenPost && state.mutedActorIds.has(current.authorActorId)) {
        return true;
      }
      current = current.parentId ? rowsById.get(current.parentId) : undefined;
    }
    return !post && row.repostOf ? state.mutedActorIds.has(rootOf(row).authorActorId) : false;
  };
  /** The posts with a reply from them that's there by now, for their Replies tab. */
  const repliedTo = new Set(
    repliedBy
      ? rows
          .filter(
            (row) =>
              row.kind === "comment" &&
              row.authorActorId === repliedBy &&
              inCondition(row) &&
              appeared(row),
          )
          .map((row) => postOf(row).id)
      : [],
  );
  const inScope = (row: ContentRow) =>
    !hiddenByBan(row, rowsById, bans, worldStartMs) &&
    repostShows(row) &&
    !mutedAway(row) &&
    (!row.adLabel || features.ads) &&
    (!tag || hasHashtag(postOf(row).body, tag)) &&
    (!place || postOf(row).place === place) &&
    (!taggedActorId ||
      postOf(row).taggedActorIds.includes(taggedActorId) ||
      (taggedActorId === context.actorId && postOf(row).tagsParticipant)) &&
    (!explore || discoverable(postOf(row))) &&
    (!repliedBy || repliedTo.has(postOf(row).id)) &&
    (!following ||
      postOf(row).authorActorId === context.actorId ||
      state.followedActorIds.has(postOf(row).authorActorId)) &&
    (!authorActorId || postOf(row).authorActorId === authorActorId) &&
    (!post || postOf(row).id === post) &&
    (list ? listed.has(postOf(row).id) : post !== undefined || !hiddenHere.has(postOf(row).id)) &&
    inSpaces(row);
  // A pin belongs to a list, so a post pinned in its community isn't also on top at home.
  const pinPlace =
    features.pinning &&
    !post &&
    !authorActorId &&
    !list &&
    !place &&
    !taggedActorId &&
    !explore &&
    !repliedBy
      ? space
        ? "space"
        : "home"
      : null;

  const feedSettings: FeedSettings = {
    ...conditionSettings,
    ranker:
      sort ??
      (list || repliedBy ? "new" : undefined) ??
      (space ? conditionSettings.spaceRanker : undefined) ??
      (following ? (conditionSettings.followingRanker ?? "new") : undefined) ??
      conditionSettings.ranker,
    commentOrder: commentSort ?? conditionSettings.commentOrder,
  };
  // Comments that wait for a post's own page aren't shown here, so they aren't recorded as shown.
  // Their replies are what the Replies tab is for, so they're shown even where comments wait.
  const commentsHere =
    post !== undefined ||
    repliedBy !== undefined ||
    !featureOn(context.settings, context.conditionKey, "postPages");
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
  const votesOf = (written: ContentRow) => {
    // A repost ranks by the post it passes along.
    const row = rootOf(written);
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

  // Whole threads were needed to place each reply, and then only theirs are kept, side by side.
  if (repliedBy) {
    feed.posts = feed.posts.map((item) => {
      const theirs = item.commentIds.filter((id) => rowsById.get(id)?.authorActorId === repliedBy);
      return {
        ...item,
        commentIds: theirs,
        commentDepths: Object.fromEntries(theirs.map((id) => [id, 0])),
      };
    });
  }

  // Ads go every so many posts in a list, not on someone's page or a post's own page.
  if (features.ads && feedSettings.adEvery && !post && !authorActorId && !list && !repliedBy) {
    feed.posts = placeAds(
      feed.posts,
      ({ id }) => Boolean(rowsById.get(id)?.adLabel),
      feedSettings.adEvery,
    );
  }

  const karmaOn = featureOn(context.settings, context.conditionKey, "karma");
  const elapsedMs = now.getTime() - worldStartMs;
  const removals = await loadRemovals(db, context, now);
  const labels = await loadLabels(db, context, now);

  const contextNotes = await loadContextNotes(db, context, now, state.noteRatings);
  const shaped = await shapeFeedPosts({
    loadAuthors: (ids) => loadAuthors(db, ids),
    mediaPublicUrl,
    conditionKey: context.conditionKey,
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
    mutedThreadIds: features.threadMuting ? state.mutedThreadIds : new Set(),
    pollChoices: state.pollChoices,
    viewerFlair: new Map(spaces.flatMap(({ id, flair }) => (flair ? [[id, flair]] : []))),
    canSeeOriginal: (row) => {
      const inVisibleSpace = !spacesOn || !row.spaceId || visibleSpaces.has(row.spaceId);
      const removed =
        (feedSettings.removeBlocked && state.blockedActorIds.has(row.authorActorId)) ||
        (feedSettings.removeFlagged && state.flaggedContentIds.has(row.id));
      return (
        inCondition(row as ContentRow) &&
        appeared(row as ContentRow) &&
        inVisibleSpace &&
        !removed &&
        !removals.has(row.id) &&
        !hiddenByBan(row, rowsById, bans, worldStartMs)
      );
    },
    removals,
    labels,
    bans,
    contextNotes,
    viewedContentIds: state.viewedContentIds,
    countable: (row) =>
      inCondition(row as ContentRow) &&
      appeared(row as ContentRow) &&
      !hiddenByBan(row as ContentRow, rowsById, bans, worldStartMs),
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
      ...(contextNotes.has(rootOf(rowsById.get(post.id) as ContentRow).id) &&
      !removals.has(rootOf(rowsById.get(post.id) as ContentRow).id)
        ? { contextNote: contextNotes.get(rootOf(rowsById.get(post.id) as ContentRow).id)?.ref }
        : {}),
      ...(commentsHere && post.commentIds.some((id) => removals.has(id))
        ? { removedCommentIds: post.commentIds.filter((id) => removals.has(id)) }
        : {}),
      // Which labels were on it, and on its comments, since they come and go as removals do.
      ...(!removals.has(post.id) && labels.has(post.id)
        ? { labels: labels.get(post.id)?.map(({ text }) => text) }
        : {}),
      ...(commentsHere && post.commentIds.some((id) => labels.has(id) && !removals.has(id))
        ? {
            labeledCommentIds: post.commentIds.filter((id) => labels.has(id) && !removals.has(id)),
          }
        : {}),
    })),
  });

  return shaped;
}
