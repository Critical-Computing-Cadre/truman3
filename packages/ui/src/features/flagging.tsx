import type { FeedComment, FeedPost } from "@truman3/core";
import { useFeature } from "../platform.tsx";
import type { PostActions } from "../post-props.ts";
import { replyIndent } from "./comments.tsx";

/** The flag button under a post. */
export function PostFlagButton({ post, actions }: { post: FeedPost; actions?: PostActions }) {
  const on = useFeature("flagging");
  if (!on || post.removed) {
    return null;
  }
  return (
    <button
      type="button"
      disabled={!actions || post.author.isViewer || post.flagged}
      className={`py-3 ${actions ? "disabled:opacity-40" : ""}`}
      onClick={() => actions?.onFlag(post.id, true)}
    >
      Flag
    </button>
  );
}

/** Covers a post someone has flagged, until they unflag it. */
export function FlaggedPostCover({ post, actions }: { post: FeedPost; actions?: PostActions }) {
  if (!post.flagged) {
    return null;
  }
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-stone-900/85 p-6 text-center text-white">
      <p className="text-xl font-semibold">You've flagged this!</p>
      <p>The admins will review this post further. We are sorry you had this experience.</p>
      <button
        type="button"
        className="rounded border border-white px-4 py-2"
        disabled={!actions}
        onClick={() => actions?.onFlag(post.id, false)}
      >
        Unflag
      </button>
    </div>
  );
}

/** The flag link beside a comment. */
export function CommentFlagButton({
  comment,
  actions,
}: {
  comment: FeedComment;
  actions?: PostActions | undefined;
}) {
  if (!useFeature("flagging") || comment.author.isViewer || comment.removed) {
    return null;
  }
  return (
    <button type="button" disabled={!actions} onClick={() => actions?.onFlag(comment.id, true)}>
      Flag
    </button>
  );
}

/** Takes the place of a comment someone has flagged. */
export function FlaggedComment({
  comment,
  actions,
}: {
  comment: FeedComment;
  actions?: PostActions | undefined;
}) {
  return (
    <li
      style={replyIndent(comment.depth)}
      className="flex items-center justify-between rounded bg-stone-800 px-3 py-2 text-sm text-white"
    >
      <span>You flagged this comment.</span>
      <button
        type="button"
        className="underline"
        disabled={!actions}
        onClick={() => actions?.onFlag(comment.id, false)}
      >
        Unflag
      </button>
    </li>
  );
}
