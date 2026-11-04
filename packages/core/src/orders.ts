/**
 * The orders a participant can choose, where a study lets them. These are also what a study can set,
 * along with `chronological`, `shuffle`, and `scripted`. How each one is worked out is in
 * packages/feed. They're ours, inspired by forums, and not any real platform's formulas (ADR 28).
 */
export const FEED_SORTS = ["new", "top", "hot", "best", "rising", "controversial"] as const;
export type FeedSort = (typeof FEED_SORTS)[number];

export const COMMENT_SORTS = ["top", "new", "best", "controversial", "old"] as const;
export type CommentSort = (typeof COMMENT_SORTS)[number];

export const SORT_LABELS: Record<FeedSort | CommentSort, string> = {
  new: "New",
  top: "Top",
  hot: "Hot",
  best: "Best",
  rising: "Rising",
  controversial: "Controversial",
  old: "Old",
};
