import type { FeedPost } from "@truman3/core";
import { type ReactNode, useState } from "react";
import { ShareIcon } from "../icons.tsx";
import { useFeature } from "../platform.tsx";
import type { PostActions } from "../post-props.ts";

/** Says a study keeps this post on top, or has stopped comments on it. */
export function PostBadges({ post, className = "" }: { post: FeedPost; className?: string }) {
  if (!post.pinned && !post.locked && !post.ad && post.viewCount === undefined) {
    return null;
  }
  return (
    <span className={`flex items-center gap-1 text-xs font-medium text-stone-600 ${className}`}>
      {post.pinned && <span className="rounded bg-stone-100 px-1.5 py-0.5">Pinned</span>}
      {post.locked && <span className="rounded bg-stone-100 px-1.5 py-0.5">Locked</span>}
      {post.ad && (
        <span data-testid="ad-label" className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">
          {post.ad}
        </span>
      )}
      {post.viewCount !== undefined && (
        <span data-testid="view-count" className="font-normal text-stone-500">
          {post.viewCount.toLocaleString("en-US")} {post.viewCount === 1 ? "view" : "views"}
        </span>
      )}
    </span>
  );
}

/** Where a post links to. It opens in a new tab, which can't reach back to this one. */
export function PostLink({ post, actions }: { post: FeedPost; actions?: PostActions | undefined }) {
  if (!post.link) {
    return null;
  }
  return (
    <a
      href={post.link.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={() => actions?.onOpenLink?.(post.id)}
      className="mx-3 mt-2 flex items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm text-sky-800"
    >
      <span className="min-w-0 truncate">{post.link.domain}</span>
      <span aria-hidden="true">↗</span>
    </a>
  );
}

const COVER_LABELS = { spoiler: "Spoiler", adult: "Adult content" } as const;

/**
 * Covers what a post says and shows until someone clicks, which is recorded each time. What's covered
 * isn't on the page at all until then, so an image doesn't load. Someone editing sees it uncovered.
 */
export function TagCover({
  post,
  actions,
  editing = false,
  children,
}: {
  post: FeedPost;
  actions?: PostActions | undefined;
  editing?: boolean;
  children: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  if (!post.tags?.length || editing || revealed) {
    return <>{children}</>;
  }
  const labels = post.tags.map((tag) => COVER_LABELS[tag]).join(", ");
  return (
    <button
      type="button"
      onClick={() => {
        setRevealed(true);
        actions?.onReveal?.(post.id);
      }}
      className="mx-3 my-2 block w-[calc(100%-1.5rem)] rounded-lg bg-stone-800 px-4 py-6 text-center text-sm text-white"
    >
      <span className="block font-semibold">{labels}</span>
      <span className="block text-stone-300">Click to show this post</span>
    </button>
  );
}

/** Keeps a post on this person's list. */
export function SaveButton({
  post,
  actions,
  className = "",
}: {
  post: FeedPost;
  actions?: PostActions | undefined;
  className?: string;
}) {
  if (!useFeature("saving")) {
    return null;
  }
  return (
    <button
      type="button"
      disabled={!actions}
      className={className}
      onClick={() => actions?.onSave?.(post.id, !post.saved)}
    >
      {post.saved ? "Saved" : "Save"}
    </button>
  );
}

/** Takes a post out of this person's feeds, or brings it back from their list. */
export function HideButton({
  post,
  actions,
  className = "",
}: {
  post: FeedPost;
  actions?: PostActions | undefined;
  className?: string;
}) {
  if (!useFeature("hiding")) {
    return null;
  }
  return (
    <button
      type="button"
      disabled={!actions}
      className={className}
      onClick={() => actions?.onHide?.(post.id, !post.hidden)}
    >
      {post.hidden ? "Unhide" : "Hide"}
    </button>
  );
}

/** Copies a link to a post, and says whether that worked. */
export function ShareButton({
  post,
  actions,
  className = "",
  look = "words",
}: {
  post: FeedPost;
  actions?: PostActions | undefined;
  className?: string;
  /** Words, an icon, or both, as a layout chooses. */
  look?: "words" | "icon" | "both";
}) {
  const on = useFeature("sharing");
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  if (!on) {
    return null;
  }
  const label = { copied: "Link copied", failed: "Couldn't copy" };
  return (
    <button
      type="button"
      disabled={!actions}
      className={`${look === "words" ? "" : "flex items-center gap-1.5"} ${className}`}
      onClick={async () => {
        setResult((await actions?.onShare?.(post.id)) ? "copied" : "failed");
      }}
    >
      {look !== "words" && <ShareIcon className="h-5 w-5" />}
      {result ? label[result] : look === "icon" ? <span className="sr-only">Share</span> : "Share"}
    </button>
  );
}
