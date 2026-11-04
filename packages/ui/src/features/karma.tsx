import type { FeedAuthor } from "@truman3/core";
import { useFeature } from "../platform.tsx";

/** Someone's points. The server only sends them when the feature's on. */
export function KarmaBadge({ author }: { author: Pick<FeedAuthor, "karma"> }) {
  const on = useFeature("karma");
  if (!on || author.karma === undefined) {
    return null;
  }
  return (
    <span className="ml-1 text-xs font-normal whitespace-nowrap text-stone-500" data-testid="karma">
      {author.karma.toLocaleString("en-US")} karma
    </span>
  );
}
