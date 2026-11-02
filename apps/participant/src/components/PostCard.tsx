import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FeedPost } from "@truman3/core";
import { CommentBox, FeedPostView } from "@truman3/ui";
import { useEffect, useRef, useState } from "react";
import { meQuery, post as send } from "../api.ts";
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
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const action = useMutation({
    mutationFn: ({ url, active }: { url: string; active: boolean }) => send(url, { active }),
    onSettled: () => client.invalidateQueries(),
  });

  const comment = useMutation({
    mutationFn: (body: string) => send(`/content/${post.id}/comments`, { body }),
    onSuccess: () => setDraft(""),
    onSettled: () => client.invalidateQueries(),
  });

  return (
    <FeedPostView
      post={post}
      rootRef={ref}
      actions={{
        onLike: (id, active) => action.mutate({ url: `/content/${id}/like`, active }),
        onFlag: (id, active) => action.mutate({ url: `/content/${id}/flag`, active }),
        onReply: () => inputRef.current?.focus(),
      }}
      renderAuthor={(author, className, children) => (
        <Link to="/u/$username" params={{ username: author.username }} className={className}>
          {children}
        </Link>
      )}
      belowComments={
        me.data && (
          <CommentBox
            seed={me.data.username}
            pictureUrl={me.data.pictureUrl}
            value={draft}
            onChange={setDraft}
            onSubmit={() => comment.mutate(draft)}
            sending={comment.isPending}
            inputRef={inputRef}
          />
        )
      }
    />
  );
}
