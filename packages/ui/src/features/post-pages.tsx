import type { FeedPost } from "@truman3/core";
import { CommentIcon } from "../icons.tsx";
import { useFeature } from "../platform.tsx";
import type { FeedPostViewProps } from "../post-props.ts";

/** How many comments a post has, and the way to them, in a list that leaves them for its own page. */
export function CommentsLink({
  post,
  renderPostLink,
  className = "",
  look = "words",
}: {
  post: FeedPost;
  className?: string;
  /** Words, or an icon with the count, as a layout chooses. */
  look?: "words" | "icon";
} & Pick<FeedPostViewProps, "renderPostLink">) {
  const pages = useFeature("postPages");
  const comments = useFeature("comments");
  if (!pages || !comments || !renderPostLink) {
    return null;
  }
  const { commentCount: count } = post;
  const words = `${count} comment${count === 1 ? "" : "s"}`;
  if (look === "icon") {
    return renderPostLink(
      post.id,
      `flex items-center gap-1.5 ${className}`,
      <>
        <CommentIcon className="h-5 w-5" />
        <span aria-hidden="true">{count > 0 ? count : ""}</span>
        <span className="sr-only">{words}</span>
      </>,
    );
  }
  return renderPostLink(post.id, className, words);
}
