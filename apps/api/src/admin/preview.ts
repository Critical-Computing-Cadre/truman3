import { type StudySettings, studySettingsSchema } from "@truman3/core";
import { type Database, schema } from "@truman3/db";
import { assembleFeed, feedSettingsFor } from "@truman3/feed";
import { and, eq, isNull } from "drizzle-orm";
import {
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
  now = new Date(),
) {
  const worldStartMs = now.getTime() - elapsedMs;

  const feed = assembleFeed(
    shownOnThisPlatform(rows, version.settings, conditionKey).map((row) =>
      toCandidate(row, worldStartMs),
    ),
    {
      actorId: "",
      conditionKey,
      flaggedContentIds: new Set(),
      viewedContentIds: new Set(),
      blockedActorIds: new Set(),
    },
    feedSettingsFor(version.settings, conditionKey),
    { nowMs: now.getTime(), seed: version.seed },
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
    likesFromReactions: new Map(),
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
  );
}
