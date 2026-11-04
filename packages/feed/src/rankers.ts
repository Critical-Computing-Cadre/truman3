import { bestScore, controversyScore, hotScore, RISING_WINDOW_MS, risingScore } from "./scores.ts";

/** A post the feed could show, with what rankers are allowed to know about it. */
export interface RankablePost {
  id: string;
  /** When it appears, in milliseconds since the epoch. */
  timeMs: number;
  /** Its order in the study definition. Empty for content created during the study. */
  position: number | null;
  /** Up votes minus down votes, including this viewer's own. Orders by votes use it. */
  score?: number;
  /** The votes behind that, for orders that care how they split. */
  ups?: number;
  downs?: number;
}

export interface RankingContext {
  /** Seeds anything random, so a world's feed order can be reproduced. */
  seed: number;
  /** Posts this viewer has already seen. */
  viewedPostIds: ReadonlySet<string>;
  /** The moment this feed is for, so orders that use age can be reproduced. */
  nowMs: number;
}

export interface RankedPost {
  id: string;
  /** Rankers that score posts can record why something ranked where it did. */
  score?: number;
}

/**
 * Decides the order of a feed. This is the extension point for new algorithms. Which ranker and
 * version produced each feed is recorded with what was shown.
 */
export interface Ranker {
  name: string;
  version: string;
  rank: (posts: readonly RankablePost[], context: RankingContext) => RankedPost[];
}

function newestFirst(a: RankablePost, b: RankablePost): number {
  return b.timeMs - a.timeMs || a.id.localeCompare(b.id);
}

/**
 * A stable random number for a post (FNV-1a), rather than shuffling the list. New posts appearing
 * don't rearrange the others, so a feed doesn't jump around between visits.
 */
function hashWithSeed(id: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // A final mix, since similar IDs would otherwise come out in similar order.
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2c1b3c6d) >>> 0;
  hash ^= hash >>> 12;
  return hash >>> 0;
}

const chronological: Ranker = {
  name: "chronological",
  version: "1",
  rank: (posts) => [...posts].sort(newestFirst).map(({ id }) => ({ id })),
};

const shuffle: Ranker = {
  name: "shuffle",
  version: "1",
  rank: (posts, { seed, viewedPostIds }) => {
    const order = (a: RankablePost, b: RankablePost) =>
      hashWithSeed(a.id, seed) - hashWithSeed(b.id, seed) || a.id.localeCompare(b.id);
    const unseen = posts.filter(({ id }) => !viewedPostIds.has(id)).sort(order);
    const seen = posts.filter(({ id }) => viewedPostIds.has(id)).sort(order);
    return [...unseen, ...seen].map(({ id }) => ({ id }));
  },
};

/** The order in the study definition, with anything created during the study first. */
const scripted: Ranker = {
  name: "scripted",
  version: "1",
  rank: (posts) => {
    const created = posts.filter(({ position }) => position === null).sort(newestFirst);
    const authored = posts
      .filter(({ position }) => position !== null)
      .sort((a, b) => (a.position as number) - (b.position as number));
    return [...created, ...authored].map(({ id }) => ({ id }));
  },
};

/** The same order as chronological, under the name forums use, so a study can say which it meant. */
const newest: Ranker = {
  name: "new",
  version: "1",
  rank: (posts) => [...posts].sort(newestFirst).map(({ id }) => ({ id })),
};

/**
 * Highest score first. A score is what the study scripted plus what's happened since, so someone's
 * own vote moves a post by one, and rarely far. Ties go to the newer post.
 */
const top: Ranker = {
  name: "top",
  version: "1",
  rank: (posts) =>
    [...posts]
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || newestFirst(a, b))
      .map(({ id, score }) => ({ id, score: score ?? 0 })),
};

/** Sorts by a number worked out from each post, highest first, and records it. */
function byScore(
  name: string,
  score: (post: RankablePost, context: RankingContext) => number,
): Ranker {
  return {
    name,
    version: "1",
    rank: (posts, context) =>
      posts
        .map((post) => ({ post, value: score(post, context) }))
        .sort((a, b) => b.value - a.value || newestFirst(a.post, b.post))
        .map(({ post, value }) => ({ id: post.id, score: value })),
  };
}

const hot = byScore("hot", ({ score, timeMs }, { nowMs }) => hotScore(score ?? 0, timeMs, nowMs));
const best = byScore("best", ({ ups, downs }) => bestScore(ups ?? 0, downs ?? 0));
const controversial = byScore("controversial", ({ ups, downs }) =>
  controversyScore(ups ?? 0, downs ?? 0),
);

/** Score per hour, with everything from the last day ahead of anything older. */
const rising: Ranker = {
  name: "rising",
  version: "1",
  rank: (posts, { nowMs }) => {
    const scored = posts.map((post) => ({
      post,
      value: risingScore(post.score ?? 0, post.timeMs, nowMs),
      recent: nowMs - post.timeMs <= RISING_WINDOW_MS,
    }));
    return scored
      .sort(
        (a, b) =>
          Number(b.recent) - Number(a.recent) || b.value - a.value || newestFirst(a.post, b.post),
      )
      .map(({ post, value }) => ({ id: post.id, score: value }));
  },
};

export const RANKERS = {
  chronological,
  shuffle,
  scripted,
  new: newest,
  top,
  hot,
  best,
  rising,
  controversial,
} as const;

export type RankerName = keyof typeof RANKERS;
