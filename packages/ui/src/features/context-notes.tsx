import type { FeedPost } from "@truman3/core";
import { useFeature } from "../platform.tsx";
import type { PostActions } from "../post-props.ts";

/** A note on a post, as if readers had added context, which someone can rate. */
export function ContextNoteBox({
  post,
  actions,
}: {
  post: FeedPost;
  actions?: PostActions | undefined;
}) {
  const on = useFeature("contextNotes");
  if (!on || !post.contextNote) {
    return null;
  }
  const { body, helpful, notHelpful, rating } = post.contextNote;
  const button = (value: "helpful" | "not_helpful", label: string, count: number) => (
    <button
      type="button"
      aria-pressed={rating === value}
      disabled={!actions?.onRateNote}
      className={rating === value ? "font-semibold underline" : ""}
      onClick={() => actions?.onRateNote?.(post.id, rating === value ? null : value)}
    >
      {label} ({count})
    </button>
  );
  return (
    <section
      aria-label="Added context"
      data-testid="context-note"
      className="mx-3 mt-2 rounded-lg border border-accent/25 bg-accent-soft px-3 py-2 text-sm"
    >
      <p className="text-xs font-semibold text-accent">Readers added context</p>
      <p className="break-words whitespace-pre-wrap">{body}</p>
      <p className="mt-1 flex gap-3 text-xs text-stone-600">
        {button("helpful", "Helpful", helpful)}
        {button("not_helpful", "Not helpful", notHelpful)}
      </p>
    </section>
  );
}
