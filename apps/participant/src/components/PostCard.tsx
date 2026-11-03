import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FeedComment, FeedPost } from "@truman3/core";
import { CommentBox, FeedPostView } from "@truman3/ui";
import { useEffect, useRef, useState } from "react";
import { flowQuery, meQuery, post as send } from "../api.ts";
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
  const me = useQuery(meQuery);
  const flow = useQuery(flowQuery);
  const [replying, setReplying] = useState(false);
  const [replyTo, setReplyTo] = useState<FeedComment | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const action = useMutation({
    mutationFn: ({ url, active }: { url: string; active: boolean }) => send(url, { active }),
    onSettled: () => client.invalidateQueries(),
  });

  const vote = useMutation({
    mutationFn: ({ id, value }: { id: string; value: "up" | "down" | null }) =>
      send(`/content/${id}/vote`, { value }),
    onSettled: () => client.invalidateQueries(),
  });

  const comment = useMutation({
    mutationFn: (body: string) => send(`/content/${replyTo?.id ?? post.id}/comments`, { body }),
    onSuccess: () => {
      setDraft("");
      setReplying(false);
      setReplyTo(null);
    },
    onSettled: () => client.invalidateQueries(),
  });

  // A box that only appears on reply can't take the cursor until it's on the page.
  useEffect(() => {
    if (replying || replyTo) {
      inputRef.current?.focus();
    }
  }, [replying, replyTo]);

  return (
    <FeedPostView
      post={post}
      rootRef={ref}
      actions={{
        onLike: (id, active) => action.mutate({ url: `/content/${id}/like`, active }),
        onVote: (id, value) => vote.mutate({ id, value }),
        onFlag: (id, active) => action.mutate({ url: `/content/${id}/flag`, active }),
        onReply: () => {
          setReplying(true);
          inputRef.current?.focus();
        },
        onReplyTo: setReplyTo,
      }}
      renderAuthor={(author, className, children) => (
        <Link to="/u/$username" params={{ username: author.username }} className={className}>
          {children}
        </Link>
      )}
      belowComments={
        me.data &&
        (flow.data?.commentBox === "open" || replying || replyTo) && (
          <>
            {replyTo && (
              <p className="flex justify-between text-xs text-stone-500">
                <span>Replying to {replyTo.author.name}</span>
                <button type="button" className="underline" onClick={() => setReplyTo(null)}>
                  Cancel
                </button>
              </p>
            )}
            <CommentBox
              seed={me.data.username}
              pictureUrl={me.data.pictureUrl}
              value={draft}
              onChange={setDraft}
              onSubmit={() => comment.mutate(draft)}
              sending={comment.isPending}
              inputRef={inputRef}
            />
          </>
        )
      }
    />
  );
}
