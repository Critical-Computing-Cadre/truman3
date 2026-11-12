import type { FeedComment, FeedPost } from "@truman3/core";
import { HeartIcon, ThumbIcon } from "../icons.tsx";
import { useFeature, usePlatform } from "../platform.tsx";
import type { PostActions } from "../post-props.ts";

/** The like button under a post. */
export function PostLikeButton({
  post,
  actions,
  look = "words",
}: {
  post: FeedPost;
  actions?: PostActions;
  /** Words, an icon with a count, or an icon with the word, as a layout chooses. */
  look?: "words" | "icon" | "both";
}) {
  // A thumb on a community feed, and a heart everywhere else.
  const LikeIcon = usePlatform().layout === "classic" ? ThumbIcon : HeartIcon;
  if (!useFeature("likes")) {
    return null;
  }
  if (look === "both") {
    return (
      <button
        type="button"
        aria-pressed={post.liked}
        disabled={!actions || Boolean(post.removed)}
        className={`flex items-center justify-center gap-1.5 py-2 ${post.liked ? "font-semibold text-like" : ""}`}
        onClick={() => actions?.onLike(post.id, !post.liked)}
      >
        <LikeIcon filled={post.liked} className="h-5 w-5" />
        Like
      </button>
    );
  }
  if (look === "icon") {
    return (
      <button
        type="button"
        aria-label={post.liked ? "Unlike" : "Like"}
        aria-pressed={post.liked}
        disabled={!actions || Boolean(post.removed)}
        className={`flex items-center gap-1 ${post.liked ? "text-like" : ""}`}
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
      className={`py-3 ${post.liked ? "font-semibold text-like" : ""} ${post.removed ? "opacity-40" : ""}`}
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
      className={`${comment.liked ? "font-semibold text-like" : ""} ${comment.removed ? "opacity-40" : ""}`}
      onClick={() => actions?.onLike(comment.id, !comment.liked)}
    >
      {comment.liked ? "Unlike" : "Like"}
      {comment.likes > 0 ? ` (${comment.likes})` : ""}
    </button>
  );
}
