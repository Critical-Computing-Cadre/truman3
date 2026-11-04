import type { FeedPost } from "@truman3/core";
import { useFeature } from "../platform.tsx";
import type { PostActions } from "../post-props.ts";

/**
 * A post's question. Someone chooses once, and can't change it. The counts only show if the server
 * sent them, which it doesn't until someone votes, unless the study shows results first.
 */
export function PostPoll({ post, actions }: { post: FeedPost; actions?: PostActions | undefined }) {
  const on = useFeature("polls");
  if (!on || !post.poll) {
    return null;
  }
  const { options, voted } = post.poll;
  const total = options.reduce((sum, { votes }) => sum + (votes ?? 0), 0);
  const showCounts = options.some(({ votes }) => votes !== undefined);

  return (
    <section aria-label="Poll" className="mx-3 mt-2 space-y-1.5 text-sm">
      {options.map(({ text, votes }, index) => {
        const percent = total > 0 ? Math.round(((votes ?? 0) / total) * 100) : 0;
        const label = (
          <>
            {showCounts && (
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 bg-stone-200"
                style={{ width: `${percent}%` }}
              />
            )}
            <span className="relative flex items-center justify-between gap-2">
              <span className="min-w-0 break-words">
                {text}
                {voted === index && <span className="ml-1 font-semibold">(your vote)</span>}
              </span>
              {showCounts && (
                <span className="shrink-0 text-xs text-stone-600">
                  {percent}% · {votes}
                </span>
              )}
            </span>
          </>
        );
        const box =
          "relative block w-full overflow-hidden rounded-lg border border-stone-300 px-3 py-2 text-left";
        return voted === null ? (
          <button
            key={text}
            type="button"
            disabled={!actions?.onPollVote}
            onClick={() => actions?.onPollVote?.(post.id, index)}
            className={`${box} hover:border-stone-500`}
          >
            {label}
          </button>
        ) : (
          <div key={text} className={box}>
            {label}
          </div>
        );
      })}
      <p className="text-xs text-stone-500">
        {showCounts
          ? `${total.toLocaleString("en-US")} ${total === 1 ? "vote" : "votes"}`
          : "See the results after you vote."}
      </p>
    </section>
  );
}
