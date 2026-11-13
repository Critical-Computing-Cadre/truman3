import { type FeedComment, type FeedPost, MAX_REPLY_DEPTH } from "@truman3/core";
import type { CSSProperties } from "react";
import { CommentIcon } from "../icons.tsx";
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
  if (!on || !actions?.onReplyTo || comment.removed || comment.depth + 1 >= MAX_REPLY_DEPTH) {
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
  post,
  look = "words",
}: {
  actions?: PostActions | undefined;
  post: Pick<FeedPost, "locked" | "removed">;
  /** The word, a speech bubble beside it, or the bubble alone, as a layout chooses. */
  look?: "words" | "both" | "icon";
}) {
  if (!useFeature("comments") || post.locked || post.removed) {
    return null;
  }
  return (
    <button
      type="button"
      disabled={!actions}
      className={look === "words" ? "py-3" : "flex items-center justify-center gap-1.5 py-2"}
      onClick={() => actions?.onReply()}
    >
      {look !== "words" && <CommentIcon {...(look === "icon" ? {} : { className: "h-5 w-5" })} />}
      {look === "icon" ? <span className="sr-only">Reply</span> : "Reply"}
    </button>
  );
}
