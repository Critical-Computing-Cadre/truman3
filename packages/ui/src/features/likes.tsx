import type { FeedComment, FeedPost } from "@truman3/core";
import { HeartIcon } from "../icons.tsx";
import { useFeature } from "../platform.tsx";
import type { PostActions } from "../post-props.ts";

/** The like button under a post. */
export function PostLikeButton({
  post,
  actions,
  look = "words",
}: {
  post: FeedPost;
  actions?: PostActions;
  /** Words, or an icon with a count, as a layout chooses. */
  look?: "words" | "icon";
}) {
  if (!useFeature("likes")) {
    return null;
  }
  if (look === "icon") {
    return (
      <button
        type="button"
        aria-label={post.liked ? "Unlike" : "Like"}
        aria-pressed={post.liked}
        disabled={!actions || Boolean(post.removed)}
        className={`flex items-center gap-1 ${post.liked ? "text-rose-600" : ""}`}
        onClick={() => actions?.onLike(post.id, !post.liked)}
      >
        <HeartIcon filled={post.liked} />
        {post.likes > 0 && <span className="text-sm font-semibold">{post.likes}</span>}
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={post.liked}
      disabled={!actions || Boolean(post.removed)}
      className={`py-3 ${post.liked ? "font-semibold text-rose-600" : ""} ${post.removed ? "opacity-40" : ""}`}
      onClick={() => actions?.onLike(post.id, !post.liked)}
    >
      {post.liked ? "♥" : "♡"} Like {post.likes > 0 && <span>({post.likes})</span>}
    </button>
  );
}

/** The like link beside a comment. */
export function CommentLikeButton({
  comment,
  actions,
}: {
  comment: FeedComment;
  actions?: PostActions | undefined;
}) {
  if (!useFeature("likes")) {
    return null;
  }
  return (
    <button
      type="button"
      disabled={!actions || Boolean(comment.removed)}
      className={`${comment.liked ? "font-semibold text-rose-600" : ""} ${comment.removed ? "opacity-40" : ""}`}
      onClick={() => actions?.onLike(comment.id, !comment.liked)}
    >
      {comment.liked ? "Unlike" : "Like"}
      {comment.likes > 0 ? ` (${comment.likes})` : ""}
    </button>
  );
}
