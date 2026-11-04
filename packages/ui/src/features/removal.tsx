import type { FeedRemoved } from "@truman3/core";
import { useFeature } from "../platform.tsx";

/**
 * What takes the place of something a moderator removed. Its author still has what they wrote, so
 * they're told that nobody else can see it. Everyone else gets only this, from the server.
 */
export function RemovedNote({
  item,
  className = "",
}: {
  item: { removed?: FeedRemoved | undefined; author: { isViewer: boolean } };
  className?: string;
}) {
  const on = useFeature("removal");
  if (!on || !item.removed) {
    return null;
  }
  const { by, reason } = item.removed;
  return (
    <div
      data-testid="removed-note"
      className={`rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600 ${className}`}
    >
      <p className="font-medium">
        Removed by {by}.{item.author.isViewer ? " Nobody else can see this now." : ""}
      </p>
      {reason && <p className="break-words whitespace-pre-wrap">Reason: {reason}</p>}
    </div>
  );
}
