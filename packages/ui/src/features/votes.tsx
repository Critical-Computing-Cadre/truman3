import type { FeedComment, FeedPost } from "@truman3/core";
import { DownIcon, UpIcon } from "../icons.tsx";
import { useFeature } from "../platform.tsx";
import type { PostActions } from "../post-props.ts";

/** Up and down buttons with the score between. Pressing your own vote again takes it back. */
export function VoteButtons({
  item,
  actions,
  className = "",
}: {
  item: Pick<FeedPost | FeedComment, "id" | "ups" | "downs" | "vote" | "removed">;
  actions?: PostActions | undefined;
  className?: string;
}) {
  if (!useFeature("votes")) {
    return null;
  }
  const button = (value: "up" | "down", label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={item.vote === value}
      disabled={!actions || Boolean(item.removed)}
      className={`${item.vote === value ? (value === "up" ? "text-vote-up" : "text-vote-down") : "hover:text-stone-900"} ${item.removed ? "opacity-40" : ""}`}
      onClick={() => actions?.onVote(item.id, item.vote === value ? null : value)}
    >
      {value === "up" ? (
        <UpIcon filled={item.vote === "up"} className="h-[1.15em] w-[1.15em]" />
      ) : (
        <DownIcon filled={item.vote === "down"} className="h-[1.15em] w-[1.15em]" />
      )}
    </button>
  );
  return (
    <span className={`inline-flex items-center justify-center gap-1.5 ${className}`}>
      {button("up", "Vote up")}
      <span
        data-testid="score"
        className={`font-semibold tabular-nums ${item.vote === "up" ? "text-vote-up" : item.vote === "down" ? "text-vote-down" : ""}`}
      >
        <span className="sr-only">Score </span>
        {item.ups - item.downs}
      </span>
      {button("down", "Vote down")}
    </span>
  );
}
