import type { StudySettings } from "@truman3/core";
import { RANKERS, type RankablePost, type RankedPost } from "./rankers.ts";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export type FeedSettings = StudySettings["feed"];

/** A study's feed settings with any changes for this condition applied. */
export function feedSettingsFor(settings: StudySettings, conditionKey: string): FeedSettings {
  const base = settings.feed;
  const changes = settings.conditions.arms.find(({ key }) => key === conditionKey)?.feed;
  return {
    ranker: changes?.ranker ?? base.ranker,
    windowHours: changes?.windowHours ?? base.windowHours,
    pinOwnPostsMinutes: changes?.pinOwnPostsMinutes ?? base.pinOwnPostsMinutes,
    removeFlagged: changes?.removeFlagged ?? base.removeFlagged,
    removeBlocked: changes?.removeBlocked ?? base.removeBlocked,
  };
}

/** A post or comment that might appear. */
export interface FeedCandidate extends RankablePost {
  kind: "post" | "comment";
  parentId: string | null;
  authorActorId: string;
  /** The condition keys it applies to. Empty means all. */
  conditions: readonly string[];
}

export interface FeedViewer {
  actorId: string;
  conditionKey: string;
  flaggedContentIds: ReadonlySet<string>;
  viewedContentIds: ReadonlySet<string>;
  blockedActorIds: ReadonlySet<string>;
}

export interface AssembledPost extends RankedPost {
  /** In time order, oldest first. */
  commentIds: string[];
  pinned: boolean;
}

export interface AssembledFeed {
  posts: AssembledPost[];
  ranker: string;
  rankerVersion: string;
}

export interface AssembleOptions {
  nowMs: number;
  seed: number;
}

/**
 * Works out what a viewer sees right now, and in what order. Each rule here comes from the study's
 * settings, so a study that doesn't turn a behavior on doesn't get it (ADR 10). It has no database
 * access, so the rules can be tested directly and rerun on stored data.
 */
export function assembleFeed(
  candidates: readonly FeedCandidate[],
  viewer: FeedViewer,
  settings: FeedSettings,
  { nowMs, seed }: AssembleOptions,
): AssembledFeed {
  const earliestMs =
    settings.windowHours === undefined ? null : nowMs - settings.windowHours * HOUR_MS;

  const isShown = (item: FeedCandidate) => {
    if (item.timeMs > nowMs) {
      return false;
    }
    if (item.conditions.length > 0 && !item.conditions.includes(viewer.conditionKey)) {
      return false;
    }
    if (settings.removeFlagged && viewer.flaggedContentIds.has(item.id)) {
      return false;
    }
    if (settings.removeBlocked && viewer.blockedActorIds.has(item.authorActorId)) {
      return false;
    }
    return true;
  };

  const shown = candidates.filter(isShown);
  const posts = shown.filter(
    (item) => item.kind === "post" && (earliestMs === null || item.timeMs >= earliestMs),
  );

  const commentsByPost = new Map<string, FeedCandidate[]>();
  for (const comment of shown) {
    if (comment.kind === "comment" && comment.parentId) {
      const siblings = commentsByPost.get(comment.parentId) ?? [];
      siblings.push(comment);
      commentsByPost.set(comment.parentId, siblings);
    }
  }

  const pinCutoffMs =
    settings.pinOwnPostsMinutes === undefined
      ? null
      : nowMs - settings.pinOwnPostsMinutes * MINUTE_MS;
  const isPinned = (post: FeedCandidate) =>
    pinCutoffMs !== null && post.authorActorId === viewer.actorId && post.timeMs >= pinCutoffMs;

  const pinned = posts.filter(isPinned).sort((a, b) => b.timeMs - a.timeMs);
  const pinnedIds = new Set(pinned.map(({ id }) => id));
  const ranker = RANKERS[settings.ranker];
  const ranked = ranker.rank(
    posts.filter(({ id }) => !pinnedIds.has(id)),
    { seed, viewedPostIds: viewer.viewedContentIds },
  );

  const withComments = (post: RankedPost, isPin: boolean): AssembledPost => ({
    ...post,
    pinned: isPin,
    commentIds: (commentsByPost.get(post.id) ?? [])
      .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id))
      .map(({ id }) => id),
  });

  return {
    posts: [
      ...pinned.map(({ id }) => withComments({ id }, true)),
      ...ranked.map((post) => withComments(post, false)),
    ],
    ranker: ranker.name,
    rankerVersion: ranker.version,
  };
}
