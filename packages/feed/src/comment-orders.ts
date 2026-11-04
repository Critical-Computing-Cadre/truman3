import type { RankablePost } from "./rankers.ts";
import { bestScore, controversyScore } from "./scores.ts";

/**
 * Decides the order of comments among others at the same level. Replies stay under what they reply
 * to in every order, so this only ever chooses between comments with the same parent. Each has a
 * version, like a ranker, and which one was used is recorded with what was shown.
 */
export interface CommentOrder {
  name: string;
  version: string;
  compare: (a: RankablePost, b: RankablePost) => number;
}

const oldestFirst = (a: RankablePost, b: RankablePost) =>
  a.timeMs - b.timeMs || a.id.localeCompare(b.id);
const newestFirst = (a: RankablePost, b: RankablePost) =>
  b.timeMs - a.timeMs || a.id.localeCompare(b.id);

export const COMMENT_ORDERS = {
  /** The time each was written for, oldest first, which is how a study reads as a conversation. */
  scripted: { name: "scripted", version: "1", compare: oldestFirst },
  new: { name: "new", version: "1", compare: newestFirst },
  /**
   * Highest score first, with ties going to the newer. A score is what the study wrote, plus what's
   * happened since, so someone's own vote moves a comment by one.
   */
  top: {
    name: "top",
    version: "1",
    compare: (a: RankablePost, b: RankablePost) =>
      (b.score ?? 0) - (a.score ?? 0) || newestFirst(a, b),
  },
  /** Oldest first. It's the same as `scripted` today, under the name a participant would choose. */
  old: { name: "old", version: "1", compare: oldestFirst },
  /** The Wilson lower bound on the share of up votes, in scores.ts. Ties go to the newer. */
  best: {
    name: "best",
    version: "1",
    compare: (a: RankablePost, b: RankablePost) =>
      bestScore(b.ups ?? 0, b.downs ?? 0) - bestScore(a.ups ?? 0, a.downs ?? 0) ||
      newestFirst(a, b),
  },
  /** All votes times how evenly they split, in scores.ts. Ties go to the newer. */
  controversial: {
    name: "controversial",
    version: "1",
    compare: (a: RankablePost, b: RankablePost) =>
      controversyScore(b.ups ?? 0, b.downs ?? 0) - controversyScore(a.ups ?? 0, a.downs ?? 0) ||
      newestFirst(a, b),
  },
} as const satisfies Record<string, CommentOrder>;

export type CommentOrderName = keyof typeof COMMENT_ORDERS;
