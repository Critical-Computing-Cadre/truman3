import {
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
  castKarma,
  type FeedActor,
  type FeedContent,
  loadAuthors,
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

export function scriptedContent(db: Database, versionId: string) {
  return db
    .select()
    .from(schema.content)
    .where(and(eq(schema.content.studyVersionId, versionId), isNull(schema.content.worldId)));
}

export interface PreviewSpace {
  id: string;
  key: string;
  name: string;
  conditions: string[];
  picture?: string | null | undefined;
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
) {
  const worldStartMs = now.getTime() - elapsedMs;
  const features = featuresFor(version.settings, conditionKey);

  // Everyone in a condition sees the same as each other here, since nobody has joined or left yet.
  const spacesOn = featureOn(version.settings, conditionKey, "spaces");
  const visible = new Map(
    (spacesOn ? spaces : [])
      .filter(({ conditions }) => conditions.length === 0 || conditions.includes(conditionKey))
      .map(({ id, key, name, picture }) => [id, { key, name, picture }]),
  );
  const shownRows = spacesOn
    ? rows.filter(({ spaceId }) => spaceId === null || visible.has(spaceId))
    : rows;

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
  );
}
