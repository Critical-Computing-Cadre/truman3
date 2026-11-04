import { type FeedComment, MAX_REPLY_DEPTH } from "@truman3/core";
import type { CSSProperties } from "react";
import { useFeature } from "../platform.tsx";
import type { PostActions } from "../post-props.ts";

/** Past a few levels, a phone has no room left to show more indent. */
const MOST_INDENTS = 4;

/** How far in a comment sits, to show what it replies to. */
export function replyIndent(depth: number): CSSProperties | undefined {
  return depth > 0 ? { marginLeft: `${Math.min(depth, MOST_INDENTS) * 1.25}rem` } : undefined;
}

/** The button beside a comment that replies to it. */
export function CommentReplyButton({
  comment,
  actions,
}: {
  comment: FeedComment;
  actions?: PostActions | undefined;
}) {
  const on = useFeature("threads");
  if (!on || !actions?.onReplyTo || comment.depth + 1 >= MAX_REPLY_DEPTH) {
    return null;
  }
  return (
    <button type="button" onClick={() => actions.onReplyTo?.(comment)}>
      Reply
    </button>
  );
}

/** The button that starts a comment. */
export function ReplyButton({
  actions,
  locked = false,
}: {
  actions?: PostActions | undefined;
  locked?: boolean | undefined;
}) {
  if (!useFeature("comments") || locked) {
    return null;
  }
  return (
    <button type="button" disabled={!actions} className="py-3" onClick={() => actions?.onReply()}>
      Reply
    </button>
  );
}
