/** A post the feed could show, with what rankers are allowed to know about it. */
export interface RankablePost {
  id: string;
  /** When it appears, in milliseconds since the epoch. */
  timeMs: number;
  /** Its order in the study definition. Empty for content created during the study. */
  position: number | null;
}

export interface RankingContext {
  /** Seeds anything random, so a world's feed order can be reproduced. */
  seed: number;
  /** Posts this viewer has already seen. */
  viewedPostIds: ReadonlySet<string>;
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

export const RANKERS = { chronological, shuffle, scripted } as const;

export type RankerName = keyof typeof RANKERS;
