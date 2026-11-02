import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FeedPost } from "@truman3/core";
import { FeedPostView } from "@truman3/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { post as send } from "../api.ts";
import { createDwellTimer } from "../dwell.ts";
import { track } from "../tracking.ts";

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
    const onPageHide = () => report(timer.setInView(false));
    window.addEventListener("pagehide", onPageHide);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      report(timer.setInView(false));
    };
  }, [contentId, surface]);

  return ref;
}

/** A post a participant can act on. How it looks comes from FeedPostView, shared with researchers. */
export function PostCard({ post, surface = "feed" }: { post: FeedPost; surface?: string }) {
  const ref = useContentDwell(post.id, surface);
  const client = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const action = useMutation({
    mutationFn: ({ url, active }: { url: string; active: boolean }) => send(url, { active }),
    onSettled: () => client.invalidateQueries(),
  });

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
    <FeedPostView
      post={post}
      rootRef={ref}
      actions={{
        onLike: (id, active) => action.mutate({ url: `/content/${id}/like`, active }),
        onFlag: (id, active) => action.mutate({ url: `/content/${id}/flag`, active }),
        onReply: () => setReplying(!replying),
      }}
      renderAuthor={(author, className, children) => (
        <Link to="/u/$username" params={{ username: author.username }} className={className}>
          {children}
        </Link>
      )}
      belowComments={
        replying ? (
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
        ) : undefined
      }
    />
  );
}
