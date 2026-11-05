import {
  DEFAULT_TEMPLATE,
  type StudySettings,
  TEMPLATES,
  type TemplateDefinition,
} from "@truman3/core";
import { COMMENT_ORDERS } from "./comment-orders.ts";
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
    reshuffleEachVisit: changes?.reshuffleEachVisit ?? base.reshuffleEachVisit,
    windowHours: changes?.windowHours ?? base.windowHours,
    pinOwnPostsMinutes: changes?.pinOwnPostsMinutes ?? base.pinOwnPostsMinutes,
    removeFlagged: changes?.removeFlagged ?? base.removeFlagged,
    removeBlocked: changes?.removeBlocked ?? base.removeBlocked,
    spaceRanker: changes?.spaceRanker ?? base.spaceRanker,
    followingRanker: changes?.followingRanker ?? base.followingRanker,
    homeTabLabel: changes?.homeTabLabel ?? base.homeTabLabel,
    followingTabLabel: changes?.followingTabLabel ?? base.followingTabLabel,
    startOnFollowing: changes?.startOnFollowing ?? base.startOnFollowing,
    participantsCanSort: changes?.participantsCanSort ?? base.participantsCanSort,
    commentOrder:
      changes?.commentOrder ??
      base.commentOrder ??
      (TEMPLATES[settings.platform.template ?? DEFAULT_TEMPLATE] as TemplateDefinition).feed
        ?.commentOrder,
    participantsCanSortComments:
      changes?.participantsCanSortComments ?? base.participantsCanSortComments,
  };
}

/** A post or comment that might appear. */
export interface FeedCandidate extends RankablePost {
  kind: "post" | "comment";
  parentId: string | null;
  authorActorId: string;
  /** The condition keys it applies to. Empty means all. */
  conditions: readonly string[];
  /** The study keeps it on top of this list. */
  studyPinned?: boolean;
}

export interface FeedViewer {
  actorId: string;
  conditionKey: string;
  flaggedContentIds: ReadonlySet<string>;
  viewedContentIds: ReadonlySet<string>;
  blockedActorIds: ReadonlySet<string>;
}

export interface AssembledPost extends RankedPost {
  /** In the study's order. With threads, each reply comes right after what it replies to. */
  commentIds: string[];
  /** How many replies down each comment is. 0 is directly on the post. */
  commentDepths: Record<string, number>;
  pinned: boolean;
  /** On top because the study says so, not because it's the viewer's own new post. */
  studyPinned: boolean;
}

export interface AssembledFeed {
  posts: AssembledPost[];
  ranker: string;
  rankerVersion: string;
  /** What ordered the comments, and which version. */
  commentOrder: string;
  commentOrderVersion: string;
  /** The seed used, so this exact order can be reproduced. */
  seed: number;
}

export interface AssembleOptions {
  nowMs: number;
  seed: number;
  /** Nest replies under what they reply to. Otherwise the same comments are one list in time order. */
  threaded?: boolean;
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
  { nowMs, seed, threaded = false }: AssembleOptions,
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
    (item) =>
      item.kind === "post" &&
      (earliestMs === null || item.timeMs >= earliestMs || item.studyPinned === true),
  );

  const shownById = new Map(shown.map((item) => [item.id, item]));

  /** A comment's post, or null if it or anything it replies to is hidden. */
  const postOf = (comment: FeedCandidate): string | null => {
    const seen = new Set<string>();
    let current = comment;
    while (current.kind === "comment") {
      const parent = current.parentId ? shownById.get(current.parentId) : undefined;
      if (!parent || seen.has(current.id)) {
        return null;
      }
      seen.add(current.id);
      current = parent;
    }
    return current.id;
  };

  const commentsByPost = new Map<string, FeedCandidate[]>();
  for (const comment of shown) {
    const postId = comment.kind === "comment" ? postOf(comment) : null;
    if (postId) {
      const siblings = commentsByPost.get(postId) ?? [];
      siblings.push(comment);
      commentsByPost.set(postId, siblings);
    }
  }

  const pinCutoffMs =
    settings.pinOwnPostsMinutes === undefined
      ? null
      : nowMs - settings.pinOwnPostsMinutes * MINUTE_MS;
  const isPinned = (post: FeedCandidate) =>
    pinCutoffMs !== null && post.authorActorId === viewer.actorId && post.timeMs >= pinCutoffMs;

  const studyPinned = posts.filter((post) => post.studyPinned);
  const studyPinnedIds = new Set(studyPinned.map(({ id }) => id));
  const newestFirst = (a: FeedCandidate, b: FeedCandidate) => b.timeMs - a.timeMs;
  const pinned = [
    ...studyPinned.sort(newestFirst),
    ...posts.filter((post) => isPinned(post) && !post.studyPinned).sort(newestFirst),
  ];
  const pinnedIds = new Set(pinned.map(({ id }) => id));
  const ranker = RANKERS[settings.ranker];
  const ranked = ranker.rank(
    posts.filter(({ id }) => !pinnedIds.has(id)),
    { seed, viewedPostIds: viewer.viewedContentIds, nowMs },
  );

  const commentOrder = COMMENT_ORDERS[settings.commentOrder ?? "scripted"];

  const withComments = (post: RankedPost, isPin: boolean): AssembledPost => {
    const comments = (commentsByPost.get(post.id) ?? []).sort(commentOrder.compare);
    const commentIds: string[] = [];
    const commentDepths: Record<string, number> = {};
    const addUnder = (parentId: string, depth: number) => {
      for (const comment of comments) {
        if (comment.parentId === parentId) {
          commentIds.push(comment.id);
          commentDepths[comment.id] = depth;
          addUnder(comment.id, depth + 1);
        }
      }
    };
    if (threaded) {
      addUnder(post.id, 0);
    } else {
      for (const { id } of comments) {
        commentIds.push(id);
        commentDepths[id] = 0;
      }
    }
    return {
      ...post,
      pinned: isPin,
      studyPinned: studyPinnedIds.has(post.id),
      commentIds,
      commentDepths,
    };
  };

  return {
    posts: [
      ...pinned.map(({ id }) => withComments({ id }, true)),
      ...ranked.map((post) => withComments(post, false)),
    ],
    seed,
    ranker: ranker.name,
    rankerVersion: ranker.version,
    commentOrder: commentOrder.name,
    commentOrderVersion: commentOrder.version,
  };
}
