import type { FeedPost } from "@truman3/core";
import { useFeature } from "../platform.tsx";
import type { FeedPostViewProps } from "../post-props.ts";

/** A post's title, which links to its own page where there is one. */
export function PostTitle({
  post,
  className,
  renderTitle,
  renderPostLink,
}: {
  post: FeedPost;
  className: string;
} & Pick<FeedPostViewProps, "renderTitle" | "renderPostLink">) {
  if (!useFeature("titles")) {
    return null;
  }
  if (renderTitle) {
    return <div className={className}>{renderTitle(post.id, post.title ?? "")}</div>;
  }
  if (!post.title) {
    return null;
  }
  return (
    <h2 className={`break-words ${className}`}>
      {renderPostLink ? renderPostLink(post.id, "", post.title) : post.title}
    </h2>
  );
}
