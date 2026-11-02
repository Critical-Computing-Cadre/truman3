import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FeedAuthor, FeedComment, FeedPost } from "@truman3/core";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { post as send } from "../api.ts";
import { createDwellTimer } from "../dwell.ts";
import { track } from "../tracking.ts";
import { Avatar } from "./Avatar.tsx";
import { shortTime } from "./time.ts";

/** Counts as being looked at once half of it is on screen. */
const IN_VIEW_THRESHOLD = 0.5;

function useContentDwell(contentId: string, surface: string) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const timer = createDwellTimer();
    const report = (dwellMs: number) => {
      if (dwellMs > 0) {
        track({
          type: "content.viewed",
          targetContentId: contentId,
          payload: { dwellMs, surface },
        });
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) {
          report(timer.setInView(entry.isIntersecting));
        }
      },
      { threshold: IN_VIEW_THRESHOLD },
    );
    observer.observe(element);

    const onVisibility = () => report(timer.setTabVisible(document.visibilityState === "visible"));
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", () => report(timer.setInView(false)));

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      report(timer.setInView(false));
    };
  }, [contentId, surface]);

  return ref;
}

function AuthorLink({
  author,
  className,
  children,
}: {
  author: FeedAuthor;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link to="/u/$username" params={{ username: author.username }} className={className}>
      {children}
    </Link>
  );
}

function useContentAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ url, active }: { url: string; active: boolean }) => send(url, { active }),
    onSettled: () => client.invalidateQueries(),
  });
}

function Comment({ comment }: { comment: FeedComment }) {
  const action = useContentAction();
  const url = (verb: string) => `/content/${comment.id}/${verb}`;

  if (comment.flagged) {
    return (
      <li className="flex items-center justify-between rounded bg-stone-800 px-3 py-2 text-sm text-white">
        <span>You flagged this comment.</span>
        <button
          type="button"
          className="underline"
          onClick={() => action.mutate({ url: url("flag"), active: false })}
        >
          Unflag
        </button>
      </li>
    );
  }

  return (
    <li className="flex gap-2">
      <AuthorLink author={comment.author}>
        <Avatar name={comment.author.name} url={comment.author.pictureUrl} size="h-8 w-8" />
      </AuthorLink>
      <div className="min-w-0 flex-1">
        <p className="text-sm break-words whitespace-pre-wrap">
          <AuthorLink author={comment.author} className="mr-1 font-semibold">
            {comment.author.name}
          </AuthorLink>
          {comment.body}
        </p>
        <p className="mt-0.5 flex gap-3 text-xs text-stone-500">
          <span>{shortTime(comment.at)}</span>
          <button
            type="button"
            className={comment.liked ? "font-semibold text-rose-600" : ""}
            onClick={() => action.mutate({ url: url("like"), active: !comment.liked })}
          >
            {comment.liked ? "Unlike" : "Like"}
            {comment.likes > 0 ? ` (${comment.likes})` : ""}
          </button>
          {!comment.author.isViewer && (
            <button type="button" onClick={() => action.mutate({ url: url("flag"), active: true })}>
              Flag
            </button>
          )}
        </p>
      </div>
    </li>
  );
}

export function PostCard({ post, surface = "feed" }: { post: FeedPost; surface?: string }) {
  const ref = useContentDwell(post.id, surface);
  const action = useContentAction();
  const client = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const comment = useMutation({
    mutationFn: (body: string) => send(`/content/${post.id}/comments`, { body }),
    onSuccess: () => {
      setDraft("");
      setReplying(false);
    },
    onSettled: () => client.invalidateQueries(),
  });

  const submitComment = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim()) {
      comment.mutate(draft);
    }
  };

  useEffect(() => {
    if (replying) {
      inputRef.current?.focus();
    }
  }, [replying]);

  return (
    <article
      ref={ref}
      aria-label={`Post by ${post.author.name}`}
      className="overflow-hidden bg-white shadow-sm sm:rounded-lg"
    >
      <header className="flex items-center gap-3 p-3">
        <AuthorLink author={post.author} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar name={post.author.name} url={post.author.pictureUrl} />
          <span className="truncate font-semibold">{post.author.name}</span>
        </AuthorLink>
        <time className="text-sm text-stone-500" dateTime={post.at}>
          {shortTime(post.at)}
        </time>
      </header>

      <div className="relative">
        {post.flagged && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-stone-900/85 p-6 text-center text-white">
            <p className="text-xl font-semibold">You've flagged this!</p>
            <p>The admins will review this post further. We are sorry you had this experience.</p>
            <button
              type="button"
              className="rounded border border-white px-4 py-2"
              onClick={() => action.mutate({ url: `/content/${post.id}/flag`, active: false })}
            >
              Unflag
            </button>
          </div>
        )}
        {post.imageUrl && (
          <img src={post.imageUrl} alt="" loading="lazy" className="w-full bg-stone-200" />
        )}
        {post.body && <p className="p-3 break-words whitespace-pre-wrap">{post.body}</p>}
      </div>

      <div className="grid grid-cols-3 border-t border-stone-200 text-sm text-stone-700">
        <button type="button" className="py-3" onClick={() => setReplying(!replying)}>
          Reply
        </button>
        <button
          type="button"
          disabled={post.author.isViewer || post.flagged}
          className="py-3 disabled:opacity-40"
          onClick={() => action.mutate({ url: `/content/${post.id}/flag`, active: true })}
        >
          Flag
        </button>
        <button
          type="button"
          aria-pressed={post.liked}
          className={`py-3 ${post.liked ? "font-semibold text-rose-600" : ""}`}
          onClick={() => action.mutate({ url: `/content/${post.id}/like`, active: !post.liked })}
        >
          {post.liked ? "♥" : "♡"} Like {post.likes > 0 && <span>({post.likes})</span>}
        </button>
      </div>

      {(post.comments.length > 0 || replying) && (
        <div className="space-y-3 border-t border-stone-200 p-3">
          <ul className="space-y-3">
            {post.comments.map((item) => (
              <Comment key={item.id} comment={item} />
            ))}
          </ul>
          {replying && (
            <form onSubmit={submitComment} className="flex gap-2">
              <input
                ref={inputRef}
                aria-label="Write a comment"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Write a comment..."
                className="min-w-0 flex-1 rounded border border-stone-300 px-3 py-2 text-base"
              />
              <button
                type="submit"
                disabled={comment.isPending || !draft.trim()}
                className="rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-40"
              >
                Post
              </button>
            </form>
          )}
        </div>
      )}
    </article>
  );
}
