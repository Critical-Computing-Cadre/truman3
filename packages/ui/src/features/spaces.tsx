import type { FeedAuthor, FeedPost } from "@truman3/core";
import type { ReactNode } from "react";
import { useFeature } from "../platform.tsx";

/** Which space a post is in. */
export function SpaceLine({
  post,
  renderSpace,
}: {
  post: FeedPost;
  renderSpace?: ((key: string, className: string, name: string) => ReactNode) | undefined;
}) {
  const on = useFeature("spaces");
  if (!on || !post.space) {
    return null;
  }
  const className = "font-medium";
  const { key, name } = post.space;
  return (
    <p className="px-3 pt-2 text-xs text-stone-500" data-testid="post-space">
      {renderSpace ? renderSpace(key, className, name) : <span className={className}>{name}</span>}
    </p>
  );
}

/**
 * A tag on someone a study has marked as a moderator. It only says so: they can't do anything a
 * scripted account couldn't. It isn't tied to spaces, since a study without them can have moderators.
 */
export function ModeratorTag({ author }: { author: FeedAuthor }) {
  if (!author.moderator) {
    return null;
  }
  return (
    <span className="ml-1 rounded bg-stone-200 px-1 py-0.5 text-[0.65rem] font-medium text-stone-700 align-middle">
      Moderator
    </span>
  );
}
