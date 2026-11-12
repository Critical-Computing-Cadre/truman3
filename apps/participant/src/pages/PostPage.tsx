import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  type CommentSort as ChosenSort,
  COMMENT_SORTS,
  type FeedResponse,
  SORT_LABELS,
} from "@truman3/core";
import { PostFrame } from "@truman3/ui";
import { useEffect, useRef } from "react";
import { flowQuery, get, post } from "../api.ts";
import { CommunityCard } from "../components/Community.tsx";
import { PostCard } from "../components/PostCard.tsx";
import { takeOpenedFrom } from "../tracking.ts";

type CommentSort = ChosenSort | null;

/** Lets someone choose the order of comments, on a study that allows it. Each choice is recorded. */
function CommentSortPicker({ sort }: { sort: CommentSort }) {
  const client = useQueryClient();
  const flow = useQuery(flowQuery);
  const change = useMutation({
    mutationFn: (next: CommentSort) => post("/comments/sort", { sort: next }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["feed"] }),
  });
  if (!flow.data?.canSortComments) {
    return null;
  }
  return (
    <div className="px-3 text-sm sm:px-0">
      <label className="flex items-center justify-end gap-2">
        Sort comments
        <select
          value={(change.isPending ? change.variables : sort) ?? ""}
          disabled={change.isPending}
          onChange={(event) => change.mutate((event.target.value || null) as CommentSort)}
          className="rounded border border-stone-300 bg-white px-2 py-1"
        >
          <option value="">Default</option>
          {COMMENT_SORTS.map((order) => (
            <option key={order} value={order}>
              {SORT_LABELS[order]}
            </option>
          ))}
        </select>
      </label>
      {change.error && (
        <p role="alert" className="mt-1 text-right text-rose-700">
          That didn't work. Please try again.
        </p>
      )}
    </div>
  );
}

/** One post, with its comments. Arriving here is recorded once, however often the post reloads. */
export function PostPage() {
  const { postId } = useParams({ from: "/gate/p/$postId" });
  const feed = useQuery({
    queryKey: ["feed", "post", postId],
    queryFn: () => get<FeedResponse>(`/feed?surface=post&post=${postId}`),
    retry: false,
  });

  const recorded = useRef<string | null>(null);
  useEffect(() => {
    if (recorded.current !== postId) {
      recorded.current = postId;
      post(`/content/${postId}/open`, { from: takeOpenedFrom() }).catch(() => {
        // It's only the record of opening it. The page itself says if the post isn't available.
      });
    }
  }, [postId]);

  const shown = feed.data?.posts[0];

  // A notification can point at one comment, which isn't on the page until the post has loaded.
  const pointedAt = useRef<string | null>(null);
  const loaded = shown !== undefined;
  useEffect(() => {
    const { hash } = window.location;
    if (!loaded || !hash.startsWith("#comment-") || pointedAt.current === hash) {
      return;
    }
    pointedAt.current = hash;
    const comment = document.getElementById(hash.slice(1));
    comment?.scrollIntoView({ block: "center" });
    comment?.classList.add("rounded", "ring-2", "ring-amber-400", "ring-offset-2");
  }, [loaded]);
  if (feed.error) {
    return <p className="p-6 text-center text-stone-500">This post isn't available.</p>;
  }
  return (
    <PostFrame side={shown?.space ? <CommunityCard spaceKey={shown.space.key} /> : undefined}>
      <Link
        to="/"
        aria-label="Back to the feed"
        className="mx-2 mt-2 inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold hover:bg-stone-200/60 sm:mx-0 sm:mt-0"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
        Back
      </Link>
      {/* Not before it's loaded, or a choice made meanwhile wouldn't show until the next reload. */}
      {feed.data && <CommentSortPicker sort={feed.data.commentSort ?? null} />}
      {shown && <PostCard post={shown} surface="post" />}
    </PostFrame>
  );
}
