import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  type FeedSort as ChosenSort,
  FEED_SORTS,
  type FeedResponse,
  SORT_LABELS,
} from "@truman3/core";
import { CreatePostBar, FeedFrame, ProfileCard, usePlatform } from "@truman3/ui";
import { useEffect, useRef, useState } from "react";
import { flowQuery, get, meQuery, post } from "../api.ts";
import { CommunitiesCard } from "../components/Community.tsx";
import { NewPostDialog } from "../components/NewPostDialog.tsx";
import { PostCard } from "../components/PostCard.tsx";
import { StoriesRow } from "../components/Stories.tsx";
import { useNewPosts } from "../live.ts";
import { ExploreCards } from "./ExplorePage.tsx";

/** Picked once per page load, for studies that reshuffle the feed on each visit. */
const VISIT = Math.floor(Math.random() * 2 ** 31);

/** The home feed, as this page shows it. A video site's Up next reads the same list (ADR 96). */
export const homeFeedQuery = {
  queryKey: ["feed", "home"],
  queryFn: () => get<FeedResponse>(`/feed?visit=${VISIT}`),
};

export type FeedSort = ChosenSort | null;

/** Lets someone choose the order, on a study that allows it. Each choice is recorded. */
export function SortPicker({
  surface,
  sort,
}: {
  surface: "home" | "space" | "following";
  /** The order the server is using, which is the last one recorded. */
  sort: FeedSort;
}) {
  const client = useQueryClient();
  const flow = useQuery(flowQuery);
  // The server takes the order from what's recorded, so this waits for that, and then for the feed.
  const change = useMutation({
    mutationFn: (next: FeedSort) => post("/feed/sort", { surface, sort: next }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["feed"] }),
  });
  if (!flow.data?.canSort) {
    return null;
  }
  return (
    <div className="px-3 text-sm sm:px-0">
      <label className="flex items-center justify-end gap-2">
        Sort
        <select
          value={(change.isPending ? change.variables : sort) ?? ""}
          disabled={change.isPending}
          onChange={(event) => change.mutate((event.target.value || null) as FeedSort)}
          className="rounded border border-stone-300 bg-white px-2 py-1"
        >
          <option value="">Default</option>
          {FEED_SORTS.map((order) => (
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

export function FeedPage() {
  const flow = useQuery(flowQuery);
  const tabs = flow.data?.features.followingFeed ? flow.data.feedTabs : null;
  /** Which tab they chose. Until they choose, it's the one the study starts on. */
  const [chosenTab, setChosenTab] = useState<"home" | "following" | null>(null);
  const tab = chosenTab ?? (tabs?.startOnFollowing ? "following" : "home");
  const feed = useQuery({
    queryKey: ["feed", tab],
    enabled: flow.isSuccess,
    queryFn: () =>
      get<FeedResponse>(tab === "following" ? `/feed?surface=following` : `/feed?visit=${VISIT}`),
  });
  const me = useQuery(meQuery);
  const newPost = useRef<HTMLDialogElement>(null);
  const client = useQueryClient();
  const [newPosts, caughtUp] = useNewPosts();
  // Whenever the feed is fetched, for whatever reason, it has what's new.
  useEffect(() => {
    if (feed.dataUpdatedAt) {
      caughtUp();
    }
  }, [feed.dataUpdatedAt, caughtUp]);

  // A short-video site shows one post at a time, with these floating over it (ADR 95). A video
  // site's grid has them above it, out of the grid (ADR 96).
  const { layout } = usePlatform();
  const oneAtATime = layout === "short-video" || layout === "video";
  const controls = (
    <>
      {flow.data?.features.posting && me.data && (
        <>
          <CreatePostBar
            seed={me.data.username}
            pictureUrl={me.data.pictureUrl}
            showPhoto={flow.data.platformStyle !== "text"}
            onOpen={() => newPost.current?.showModal()}
          />
          <NewPostDialog
            style={flow.data.platformStyle}
            several={flow.data.features.galleries}
            dialogRef={newPost}
          />
        </>
      )}
      {tabs && (
        <div role="tablist" aria-label="Feeds" className="flex border-b border-stone-200 bg-white">
          {(["home", "following"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setChosenTab(key)}
              className={`flex-1 py-3 text-sm font-medium ${
                tab === key ? "border-b-2 border-accent font-semibold" : "text-stone-500"
              }`}
            >
              {key === "home" ? tabs.home : tabs.following}
            </button>
          ))}
        </div>
      )}
      {feed.data && <SortPicker surface={tab} sort={feed.data.sort ?? null} />}
      {newPosts && (
        <div className="sticky top-2 z-10 flex justify-center">
          <button
            type="button"
            onClick={() => {
              window.scrollTo({ top: 0 });
              client.invalidateQueries({ queryKey: ["feed", tab] });
            }}
            className="rounded-full bg-accent-fill px-4 py-1.5 text-sm font-medium text-on-accent shadow"
          >
            New posts
          </button>
        </div>
      )}
    </>
  );
  const posts = (
    <>
      {feed.data?.posts.length === 0 && (
        <p className="p-6 text-center text-stone-500">No posts to show.</p>
      )}
      {feed.data?.posts.map((post) => (
        <PostCard key={post.repostedBy?.id ?? post.id} post={post} />
      ))}
    </>
  );

  return (
    <FeedFrame
      {...(oneAtATime
        ? { top: controls }
        : flow.data?.features.stories
          ? {
              top: (
                <StoriesRow
                  canPost={flow.data.features.posting}
                  {...(me.data ? { me: me.data } : {})}
                />
              ),
            }
          : {})}
      renderProfile={(compact) =>
        me.data && (
          <ProfileCard
            {...me.data}
            compact={compact}
            renderName={(className, name) => (
              <Link to="/u/$username" params={{ username: me.data.username }} className={className}>
                {name}
              </Link>
            )}
            footer={
              <Link
                to="/account"
                className="block border-t border-stone-200 py-2 text-center text-sm text-stone-700"
              >
                Edit profile
              </Link>
            }
          />
        )
      }
      side={
        <>
          {flow.data?.features.spaces && <CommunitiesCard />}
          {(flow.data?.features.trending || flow.data?.features.whoToFollow) && <ExploreCards />}
        </>
      }
    >
      {!oneAtATime && controls}
      {posts}
    </FeedFrame>
  );
}
