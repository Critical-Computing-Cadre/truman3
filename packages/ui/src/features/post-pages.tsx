import type { FeedPost } from "@truman3/core";
import { useFeature } from "../platform.tsx";
import type { FeedPostViewProps } from "../post-props.ts";

/** How many comments a post has, and the way to them, in a list that leaves them for its own page. */
export function CommentsLink({
  post,
  renderPostLink,
  className = "",
}: {
  post: FeedPost;
  className?: string;
} & Pick<FeedPostViewProps, "renderPostLink">) {
  const pages = useFeature("postPages");
  const comments = useFeature("comments");
  if (!pages || !comments || !renderPostLink) {
    return null;
  }
  const { commentCount: count } = post;
  return renderPostLink(post.id, className, `${count} comment${count === 1 ? "" : "s"}`);
}
