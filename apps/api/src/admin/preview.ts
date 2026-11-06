import {
  type Flair,
  featureOn,
  featuresFor,
  type StudySettings,
  scriptedKarmaChange,
  startingKarmaFor,
  studySettingsSchema,
} from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { assembleFeed, feedSettingsFor } from "@truman3/feed";
import { and, eq, isNull } from "drizzle-orm";
import {
  type Ban,
  castKarma,
  contentTimeMs,
  type FeedActor,
  type FeedContent,
  hiddenByBan,
  loadAuthors,
  type Removal,
  type ShownNote,
  shapeFeedPosts,
  shownOnThisPlatform,
  toCandidate,
} from "../feed/build.ts";

/** A study version's frozen details, for researchers to look at. */
export async function loadVersion(db: Database, versionId: string) {
  const [row] = await db
    .select({
      version: schema.studyVersions,
      slug: schema.studies.slug,
      studyId: schema.studies.id,
    })
    .from(schema.studyVersions)
    .innerJoin(schema.studies, eq(schema.studies.id, schema.studyVersions.studyId))
    .where(eq(schema.studyVersions.id, versionId));
  return row ? { ...row, settings: studySettingsSchema.parse(row.version.settings) } : null;
}

export async function scriptedContent(db: Database, versionId: string) {
  const rows = await db
    .select()
    .from(schema.content)
    .where(and(eq(schema.content.studyVersionId, versionId), isNull(schema.content.worldId)));
  return rows.filter(({ kind }) => kind !== "story");
}

export interface PreviewSpace {
  id: string;
  key: string;
  name: string;
  conditions: string[];
  picture?: string | null | undefined;
  postFlair?: readonly Flair[] | undefined;
  userFlair?: readonly Flair[] | undefined;
}

/**
 * What a new participant in this condition would see at this point in the study. It uses the same
 * rules and shaping as the real feed, but writes nothing, since looking isn't participating. It
 * works on frozen versions and on drafts alike.
 */
export async function previewContent(
  rows: readonly FeedContent[],
  authors: (ids: string[]) => Promise<ReadonlyMap<string, FeedActor>>,
  mediaPublicUrl: string,
  version: { seed: number; settings: StudySettings },
  conditionKey: string,
  elapsedMs: number,
  spaces: readonly PreviewSpace[] = [],
  now = new Date(),
  /** What the study removes. The draft's editor leaves these out, so what's removed can be edited. */
  scriptedRemovals: readonly {
    contentId: string;
    actorId: string;
    offsetMs: number;
    reason: string | null;
    conditions: string[];
  }[] = [],
  scriptedBans: readonly {
    bannedActorId: string;
    actorId: string;
    offsetMs: number;
    reason: string | null;
    spaceId: string | null;
    conditions: string[];
  }[] = [],
  /** Shows a repost as its own card, so a researcher can edit it. */
  repostsAsThemselves = false,
  scriptedNotes: readonly {
    contentId: string;
    ref: string;
    body: string;
    offsetMs: number;
    baseHelpful: number;
    baseNotHelpful: number;
    conditions: string[];
  }[] = [],
) {
  const worldStartMs = now.getTime() - elapsedMs;
  const features = featuresFor(version.settings, conditionKey);
  const removals = new Map<string, Removal>();
  if (features.removal) {
    for (const removal of [...scriptedRemovals].sort((a, b) => a.offsetMs - b.offsetMs)) {
      const applies = removal.conditions.length === 0 || removal.conditions.includes(conditionKey);
      if (applies && removal.offsetMs <= elapsedMs && !removals.has(removal.contentId)) {
        removals.set(removal.contentId, {
          actorId: removal.actorId,
          reason: removal.reason,
          at: new Date(worldStartMs + removal.offsetMs),
        });
      }
    }
  }

  // Everyone in a condition sees the same as each other here, since nobody has joined or left yet.
  const spacesOn = featureOn(version.settings, conditionKey, "spaces");
  const visible = new Map(
    (spacesOn ? spaces : [])
      .filter(({ conditions }) => conditions.length === 0 || conditions.includes(conditionKey))
      .map(({ id, key, name, picture, postFlair, userFlair }) => [
        id,
        { key, name, picture, postFlair, userFlair },
      ]),
  );
  const bans: Ban[] = features.bans
    ? scriptedBans
        .filter(
          ({ conditions, offsetMs }) =>
            offsetMs <= elapsedMs && (conditions.length === 0 || conditions.includes(conditionKey)),
        )
        .map(({ bannedActorId, actorId, reason, spaceId, offsetMs }) => ({
          bannedActorId,
          actorId,
          reason,
          spaceId,
          at: new Date(worldStartMs + offsetMs),
        }))
    : [];
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const contextNotes = new Map<string, ShownNote>();
  if (features.contextNotes) {
    for (const note of [...scriptedNotes].sort((a, b) => a.offsetMs - b.offsetMs)) {
      const applies = note.conditions.length === 0 || note.conditions.includes(conditionKey);
      if (applies && note.offsetMs <= elapsedMs && !contextNotes.has(note.contentId)) {
        contextNotes.set(note.contentId, {
          ref: note.ref,
          body: note.body,
          helpful: note.baseHelpful,
          notHelpful: note.baseNotHelpful,
          rating: null,
        });
      }
    }
  }
  const shownRows = (
    spacesOn ? rows.filter(({ spaceId }) => spaceId === null || visible.has(spaceId)) : rows
  ).filter((row) => {
    if (hiddenByBan(row, rowsById, bans, worldStartMs)) {
      return false;
    }
    if (!row.repostOf || repostsAsThemselves) {
      return true;
    }
    let root = row;
    for (let step = 0; root.repostOf && step < rows.length; step++) {
      root = rowsById.get(root.repostOf) ?? root;
    }
    return (
      features.reposts &&
      (root.conditions.length === 0 || root.conditions.includes(conditionKey)) &&
      contentTimeMs(root, worldStartMs) <= now.getTime()
    );
  });

  const feed = assembleFeed(
    shownOnThisPlatform(shownRows, version.settings, conditionKey).map((row) => ({
      ...toCandidate(row, worldStartMs),
      studyPinned: features.pinning && row.pinnedOn.includes("home"),
    })),
    {
      actorId: "",
      conditionKey,
      flaggedContentIds: new Set(),
      viewedContentIds: new Set(),
      blockedActorIds: new Set(),
    },
    feedSettingsFor(version.settings, conditionKey),
    {
      nowMs: now.getTime(),
      seed: version.seed,
      threaded: featureOn(version.settings, conditionKey, "threads"),
    },
  );

  const posts = await shapeFeedPosts({
    loadAuthors: authors,
    mediaPublicUrl,
    feed,
    rows,
    worldStartMs,
    viewerActorId: "",
    likedContentIds: new Set(),
    flaggedContentIds: new Set(),
    scriptedCounts: new Map(),
    viewerVotes: new Map(),
    features,
    removals,
    bans,
    contextNotes,
    repostsAsThemselves,
    countable: (row) =>
      (row.conditions.length === 0 || row.conditions.includes(conditionKey)) &&
      contentTimeMs(row, worldStartMs) <= now.getTime() &&
      !hiddenByBan(row, rowsById, bans, worldStartMs),
    canSeeOriginal: (row) =>
      !removals.has(row.id) &&
      !hiddenByBan(row, rowsById, bans, worldStartMs) &&
      (row.conditions.length === 0 || row.conditions.includes(conditionKey)) &&
      contentTimeMs(row, worldStartMs) <= now.getTime() &&
      (!spacesOn || !row.spaceId || visible.has(row.spaceId)),
    spaces: visible,
    karma: featureOn(version.settings, conditionKey, "karma")
      ? {
          viewer:
            startingKarmaFor(version.settings, conditionKey) +
            scriptedKarmaChange(version.settings, conditionKey, null, elapsedMs),
          cast: (username, written) =>
            castKarma(version.settings, conditionKey, username, written, elapsedMs),
        }
      : undefined,
  });

  const targeting: Record<string, string[]> = {};
  const shown = new Set(feed.posts.flatMap((post) => [post.id, ...post.commentIds]));
  for (const row of rows) {
    if (shown.has(row.id) && row.conditions.length > 0) {
      targeting[row.id] = row.conditions;
    }
  }

  return { posts, targeting };
}

export async function previewFeed(
  db: Database,
  mediaPublicUrl: string,
  version: { id: string; seed: number; settings: StudySettings },
  conditionKey: string,
  elapsedMs: number,
) {
  return previewContent(
    await scriptedContent(db, version.id),
    (ids) => loadAuthors(db, ids),
    mediaPublicUrl,
    version,
    conditionKey,
    elapsedMs,
    await db
      .select({
        id: schema.spaces.id,
        key: schema.spaces.key,
        name: schema.spaces.name,
        conditions: schema.spaces.conditions,
        picture: schema.spaces.picture,
      })
      .from(schema.spaces)
      .where(eq(schema.spaces.studyVersionId, version.id)),
    new Date(),
    await db
      .select()
      .from(schema.scriptedRemovals)
      .where(eq(schema.scriptedRemovals.studyVersionId, version.id)),
    await db
      .select()
      .from(schema.scriptedBans)
      .where(eq(schema.scriptedBans.studyVersionId, version.id)),
    false,
    await db
      .select()
      .from(schema.scriptedContextNotes)
      .where(eq(schema.scriptedContextNotes.studyVersionId, version.id)),
  );
}
