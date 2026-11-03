import { useFeature } from "../platform.tsx";
import type { PostActions } from "../post-props.ts";

/** The button that starts a comment. */
export function ReplyButton({ actions }: { actions?: PostActions | undefined }) {
  if (!useFeature("comments")) {
    return null;
  }
  return (
    <button type="button" disabled={!actions} className="py-3" onClick={() => actions?.onReply()}>
      Reply
    </button>
  );
}
