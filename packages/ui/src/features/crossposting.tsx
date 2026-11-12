import type { FeedPost } from "@truman3/core";
import { useFeature } from "../platform.tsx";
import type { FeedPostViewProps, PostActions } from "../post-props.ts";

/**
 * Shows the post a crosspost came from, inside it. It has its own votes and comments, which aren't
 * shown here. If this person can't see the original, it says so and shows nothing of it.
 */
export function CrosspostOriginal({
  post,
  renderPostLink,
  renderSpace,
}: { post: FeedPost } & Pick<FeedPostViewProps, "renderPostLink" | "renderSpace">) {
  const on = useFeature("crossposting");
  if (!on || !post.crosspost) {
    return null;
  }
  const { original } = post.crosspost;
  if (!original) {
    return (
      <p
        data-testid="crosspost-original"
        className="mx-3 mt-2 rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-500"
      >
        Crossposted. The original post isn't available.
      </p>
    );
  }
  const heading = original.title ?? "The original post";
  return (
    <section
      aria-label="Crossposted from"
      data-testid="crosspost-original"
      className="mx-3 mt-2 space-y-1 rounded-lg border border-stone-200 p-3 text-sm"
    >
      <p className="text-xs text-stone-500">
        Crossposted from{" "}
        {original.space ? (
          renderSpace ? (
            renderSpace(original.space.key, "font-medium underline", original.space.name)
          ) : (
            <span className="font-medium">{original.space.name}</span>
          )
        ) : (
          "the main feed"
        )}{" "}
        · {original.authorName}
      </p>
      <p className="font-semibold break-words">
        {renderPostLink
          ? renderPostLink(original.id, "underline-offset-2 hover:underline", heading)
          : heading}
      </p>
      {original.body && (
        <p className="line-clamp-3 break-words whitespace-pre-wrap text-stone-700">
          {original.body}
        </p>
      )}
      {original.linkDomain && <p className="text-xs text-accent">{original.linkDomain}</p>}
      {original.imageUrl && (
        <img
          src={original.imageUrl}
          alt=""
          loading="lazy"
          className="max-h-64 w-full rounded object-cover"
        />
      )}
    </section>
  );
}

/** Starts sharing a post into another community. */
export function CrosspostButton({
  post,
  actions,
  className = "",
}: {
  post: FeedPost;
  actions?: PostActions | undefined;
  className?: string;
}) {
  const crossposting = useFeature("crossposting");
  const posting = useFeature("posting");
  const spaces = useFeature("spaces");
  if (!crossposting || !posting || !spaces || post.removed) {
    return null;
  }
  return (
    <button
      type="button"
      disabled={!actions?.onCrosspost}
      className={className}
      onClick={() => actions?.onCrosspost?.(post)}
    >
      Crosspost
    </button>
  );
}
