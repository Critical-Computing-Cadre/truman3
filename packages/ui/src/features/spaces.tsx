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

/** A community's picture and name, at the top of a post's card. */
export function SpaceChip({
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
  const { key, name, pictureUrl } = post.space;
  const className = "font-semibold text-stone-800 underline-offset-2 hover:underline";
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-testid="post-space">
      {pictureUrl ? (
        <img src={pictureUrl} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-[0.65rem] font-semibold text-stone-600">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      {renderSpace ? renderSpace(key, className, name) : <span className={className}>{name}</span>}
      <span aria-hidden="true">·</span>
    </span>
  );
}

/**
 * A tag on someone a study has marked as a moderator. It only says so: they can't do anything a
 * scripted account couldn't. It isn't tied to spaces, since a study without them can have moderators.
 */
export function ModeratorTag({ author }: { author: FeedAuthor }) {
  const tag = "ml-1 rounded px-1 py-0.5 text-[0.65rem] font-medium align-middle";
  return (
    <>
      {author.moderator && <span className={`${tag} bg-stone-200 text-stone-700`}>Moderator</span>}
      {author.badge && (
        <span data-testid="author-badge" className={`${tag} bg-sky-100 text-sky-900`}>
          {author.badge}
        </span>
      )}
      {author.banned && <span className={`${tag} bg-rose-100 text-rose-800`}>Banned</span>}
    </>
  );
}
