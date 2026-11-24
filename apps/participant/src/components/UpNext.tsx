import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { FeedPost } from "@truman3/core";
import { countWords, lengthWords } from "@truman3/ui";
import { useEffect, useState } from "react";
import { homeFeedQuery } from "../pages/FeedPage.tsx";
import { rememberOpenedFrom } from "../tracking.ts";

/** Seconds between one video ending and the next starting, with a chance to stop it. */
const COUNTDOWN = 5;

const nameOf = (post: FeedPost) => post.title ?? post.body.split("\n")[0]?.slice(0, 100) ?? "";

// Whether the next video plays by itself, for the rest of their visit. On unless they turn it off.
let autoplayOn = true;

/** What comes after this post: the rest of the home feed, in its order, starting after it. */
function nextPosts(posts: FeedPost[], currentId: string) {
  const at = posts.findIndex(({ id }) => id === currentId);
  const after = at === -1 ? posts : [...posts.slice(at + 1), ...posts.slice(0, at)];
  return after.filter(({ id, repostedBy }) => id !== currentId && !repostedBy).slice(0, 12);
}

/**
 * Up next, down the side of a video site's watch page (ADR 96). Opening one records that it came
 * from here. When the video ends, the first one starts after a short countdown, unless they've
 * turned autoplay off or press Cancel, and that's recorded as coming from autoplay.
 */
export function UpNext({ currentId, ended }: { currentId: string; ended: boolean }) {
  const feed = useQuery(homeFeedQuery);
  const navigate = useNavigate();
  const client = useQueryClient();
  const [autoplay, setAutoplay] = useState(autoplayOn);
  const [left, setLeft] = useState<number | null>(null);
  const posts = nextPosts(feed.data?.posts ?? [], currentId);
  const next = posts[0];

  // A new video, or turning autoplay off, stops any countdown.
  useEffect(() => {
    setLeft(ended && autoplay && next ? COUNTDOWN : null);
  }, [ended, autoplay, next]);
  useEffect(() => {
    if (left === null || !next) {
      return;
    }
    if (left === 0) {
      rememberOpenedFrom("autoplay");
      setLeft(null);
      navigate({ to: "/p/$postId", params: { postId: next.id } });
      return;
    }
    const timer = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, next, navigate]);
  // So Up next is ready when the watch page is opened straight from a link.
  useEffect(() => {
    client.prefetchQuery(homeFeedQuery);
  }, [client]);

  return (
    <section aria-label="Up next" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Up next</h2>
        <label className="flex items-center gap-2 text-sm">
          Autoplay
          <input
            type="checkbox"
            role="switch"
            aria-checked={autoplay}
            checked={autoplay}
            onChange={(event) => {
              autoplayOn = event.target.checked;
              setAutoplay(event.target.checked);
            }}
            className="h-4 w-4 accent-[var(--color-accent-fill)]"
          />
        </label>
      </div>
      {left !== null && next && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl bg-stone-900 p-3 text-sm text-white"
        >
          <span className="flex-1">
            Up next in {left}: <strong>{nameOf(next)}</strong>
          </span>
          <button
            type="button"
            onClick={() => setLeft(null)}
            className="rounded-full bg-white/20 px-3 py-1 font-semibold"
          >
            Cancel
          </button>
        </div>
      )}
      <ul className="space-y-3">
        {posts.map((post) => {
          const [first] = post.attachments;
          const picture = first?.type === "video" ? first.posterUrl : first?.url;
          return (
            <li key={post.id}>
              <Link
                to="/p/$postId"
                params={{ postId: post.id }}
                onClick={() => rememberOpenedFrom("upNext")}
                className="flex gap-2"
              >
                <span className="relative block aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-stone-200">
                  {picture && (
                    <img
                      src={picture}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  )}
                  {first?.type === "video" && first.seconds !== undefined && (
                    <span className="absolute right-1 bottom-1 rounded bg-[#000]/80 px-1 text-[0.65rem] font-semibold text-[#fff]">
                      {lengthWords(first.seconds)}
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="line-clamp-2 text-sm font-semibold leading-snug">
                    {nameOf(post)}
                  </span>
                  <span className="mt-0.5 block text-xs text-stone-600">{post.author.name}</span>
                  {post.viewCount !== undefined && (
                    <span className="block text-xs text-stone-600">
                      {countWords(post.viewCount)} views
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
