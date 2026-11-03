import type { FeedComment, FeedPost } from "@truman3/core";
import { useFeature } from "../platform.tsx";
import type { PostActions } from "../post-props.ts";

/** Up and down buttons with the score between. Pressing your own vote again takes it back. */
export function VoteButtons({
  item,
  actions,
  className = "",
}: {
  item: Pick<FeedPost | FeedComment, "id" | "ups" | "downs" | "vote">;
  actions?: PostActions | undefined;
  className?: string;
}) {
  if (!useFeature("votes")) {
    return null;
  }
  const button = (value: "up" | "down", label: string, symbol: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={item.vote === value}
      disabled={!actions}
      className={item.vote === value ? "font-semibold text-sky-700" : ""}
      onClick={() => actions?.onVote(item.id, item.vote === value ? null : value)}
    >
      {symbol}
    </button>
  );
  return (
    <span className={`inline-flex items-center justify-center gap-1.5 ${className}`}>
      {button("up", "Vote up", "\u25B2")}
      <span data-testid="score">
        <span className="sr-only">Score </span>
        {item.ups - item.downs}
      </span>
      {button("down", "Vote down", "\u25BC")}
    </span>
  );
}
