import type { FeedOriginal, FeedPost } from "@truman3/core";
import { RepostIcon } from "../icons.tsx";
import { useFeature } from "../platform.tsx";
import type { FeedPostViewProps, PostActions } from "../post-props.ts";

/** Who passed this along, above a post that's in a list under their name. */
export function RepostedBy({ post }: { post: FeedPost }) {
  if (!post.repostedBy) {
    return null;
  }
  const { name, isViewer, via } = post.repostedBy;
  return (
    <p data-testid="reposted-by" className="px-3 pt-2 text-xs font-medium text-stone-500">
      ⟲ {isViewer ? "You" : name} reposted{via ? `, via ${via}` : ""}
    </p>
  );
}

/** The button that passes a post along, or takes that back. */
export function RepostButton({
  post,
  actions,
  className = "",
  look = "words",
}: {
  post: FeedPost;
  actions?: PostActions | undefined;
  className?: string;
  look?: "words" | "icon";
}) {
  if (!useFeature("reposts") || post.removed) {
    return null;
  }
  const count = post.repostCount ?? 0;
  if (look === "icon") {
    return (
      <button
        type="button"
        aria-label={post.reposted ? "Reposted" : "Repost"}
        aria-pressed={Boolean(post.reposted)}
        disabled={!actions?.onRepost}
        className={`flex items-center gap-1 ${className} ${post.reposted ? "text-emerald-700" : ""}`}
        onClick={() => actions?.onRepost?.(post.id, !post.reposted)}
      >
        <RepostIcon />
        {count > 0 && <span className="text-sm font-semibold">{count}</span>}
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={Boolean(post.reposted)}
      disabled={!actions?.onRepost}
      className={`${className} ${post.reposted ? "font-semibold text-emerald-700" : ""}`}
      onClick={() => actions?.onRepost?.(post.id, !post.reposted)}
    >
      ⟲ {post.reposted ? "Reposted" : "Repost"}
      {count > 0 ? ` (${count})` : ""}
    </button>
  );
}

/** The button that starts a post quoting this one. */
export function QuoteButton({
  post,
  actions,
  className = "",
}: {
  post: FeedPost;
  actions?: PostActions | undefined;
  className?: string;
}) {
  if (!useFeature("quotes") || post.removed) {
    return null;
  }
  const count = post.quoteCount ?? 0;
  return (
    <button
      type="button"
      disabled={!actions?.onQuote}
      className={className}
      onClick={() => actions?.onQuote?.(post)}
    >
      Quote{count > 0 ? ` (${count})` : ""}
    </button>
  );
}

/** What a quote shows of the post it quotes. If this person can't see that, it says so. */
export function QuotedPost({
  post,
  renderPostLink,
}: { post: FeedPost } & Pick<FeedPostViewProps, "renderPostLink">) {
  if (!post.quote) {
    return null;
  }
  const { original } = post.quote;
  if (!original) {
    return (
      <p
        data-testid="quoted-post"
        className="mx-3 mt-2 rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-500"
      >
        The original post isn't available.
      </p>
    );
  }
  const inside = <QuoteInside original={original} />;
  return (
    <section
      data-testid="quoted-post"
      aria-label={`Quoting ${original.authorName}`}
      className="mx-3 mt-2 rounded-lg border border-stone-200 px-3 py-2 text-sm"
    >
      {renderPostLink ? renderPostLink(original.id, "block", inside) : inside}
    </section>
  );
}

function QuoteInside({ original }: { original: FeedOriginal }) {
  return (
    <>
      <p className="text-xs font-semibold text-stone-700">{original.authorName}</p>
      {original.title && <p className="font-semibold">{original.title}</p>}
      {original.body && (
        <p className="line-clamp-4 break-words whitespace-pre-wrap text-stone-700">
          {original.body}
        </p>
      )}
      {original.imageUrl && (
        <img
          src={original.imageUrl}
          alt=""
          loading="lazy"
          className="mt-1 max-h-64 w-full rounded object-cover"
        />
      )}
    </>
  );
}
