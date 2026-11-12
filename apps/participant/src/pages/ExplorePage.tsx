import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { FeedResponse, LayoutKey } from "@truman3/core";
import { Avatar, useFeature, usePlatform } from "@truman3/ui";
import { get, post } from "../api.ts";
import { PostCard } from "../components/PostCard.tsx";
import { PostGrid } from "../components/PostGrid.tsx";

interface Explore {
  trending: { tag: string; note?: string }[];
  suggested: {
    username: string;
    name: string;
    pictureUrl: string | null;
    badge?: string;
    followerCount?: number;
  }[];
}

const CARD = "rounded-lg bg-white p-4 shadow-sm";

/**
 * How the cards beside a feed look on each kind of site: what they're called, what they sit on,
 * and what the Follow button looks like. A screen reader hears the same names on all four.
 */
const SIDE: Record<
  LayoutKey,
  { card: string; heading: string; trending: string; suggested: string; follow: string }
> = {
  classic: {
    card: CARD,
    heading: "mb-2 font-semibold text-stone-600",
    trending: "Trending",
    suggested: "People you may know",
    follow: "rounded-md bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent",
  },
  photo: {
    card: "px-1",
    heading: "mb-3 text-sm font-semibold text-stone-500",
    trending: "Trending",
    suggested: "Suggested for you",
    follow: "text-xs font-semibold text-accent",
  },
  "short-posts": {
    card: "rounded-2xl border border-stone-200 p-4",
    heading: "mb-3 text-xl font-extrabold",
    trending: "What's happening",
    suggested: "Who to follow",
    follow: "rounded-full bg-stone-900 px-4 py-1.5 text-sm font-bold text-white",
  },
  forum: {
    card: "rounded-xl border border-stone-200 bg-white p-4",
    heading: "mb-3 text-xs font-semibold tracking-wide text-stone-500 uppercase",
    trending: "Trending today",
    suggested: "People to follow",
    follow: "rounded-full border border-accent px-3 py-1 text-sm font-semibold text-accent",
  },
};

export const exploreQuery = {
  queryKey: ["explore"],
  queryFn: () => get<Explore>("/explore"),
};

/** What's said to be trending, and who's suggested for following, wherever they go. */
export function ExploreCards() {
  const client = useQueryClient();
  const explore = useQuery(exploreQuery);
  const follow = useMutation({
    mutationFn: (username: string) =>
      post(`/actors/${encodeURIComponent(username)}/relation`, { action: "follow" }),
    onSettled: () => client.invalidateQueries(),
  });
  const { trending = [], suggested = [] } = explore.data ?? {};
  const look = SIDE[usePlatform().layout];
  return (
    <>
      {trending.length > 0 && (
        <section aria-label="Trending" className={look.card}>
          <h2 className={look.heading}>{look.trending}</h2>
          <ul className="space-y-2">
            {trending.map(({ tag, note }) => (
              <li key={tag}>
                <Link
                  to="/tags/$tag"
                  params={{ tag }}
                  className="block font-medium underline-offset-2 hover:underline"
                >
                  #{tag}
                </Link>
                {note && <p className="text-xs text-stone-500">{note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {suggested.length > 0 && (
        <section aria-label="Who to follow" className={look.card}>
          <h2 className={look.heading}>{look.suggested}</h2>
          <ul className="space-y-3">
            {suggested.map(({ username, name, pictureUrl, badge, followerCount }) => (
              <li key={username} className="flex items-center gap-2">
                <Avatar seed={username} url={pictureUrl} size="h-9 w-9" />
                <div className="min-w-0 flex-1 text-sm">
                  <Link
                    to="/u/$username"
                    params={{ username }}
                    className="block truncate font-medium underline-offset-2 hover:underline"
                  >
                    {name}
                  </Link>
                  <p className="truncate text-xs text-stone-500">
                    {badge ? `${badge} · ` : ""}
                    {followerCount !== undefined ? `${followerCount} followers` : `@${username}`}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={follow.isPending}
                  onClick={() => follow.mutate(username)}
                  className={look.follow}
                >
                  Follow
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Whether a list of posts can be a grid of photos, which needs each post's own page to open. */
function useGrid() {
  const grid = useFeature("profileGrid");
  const pages = useFeature("postPages");
  return grid && pages;
}

/** Photos from people someone doesn't follow, on a platform with an Explore grid. */
function ExploreGrid() {
  const posts = useQuery({
    queryKey: ["feed", "explore"],
    queryFn: () => get<FeedResponse>("/feed?surface=explore"),
  });
  if (posts.data?.posts.length === 0) {
    return <p className="p-6 text-center text-stone-500">Nothing to explore yet.</p>;
  }
  return <PostGrid posts={posts.data?.posts ?? []} label="Explore" />;
}

/**
 * Where a phone reaches what a wide screen shows beside the feed, and, on a platform with an
 * Explore grid, photos from people someone doesn't follow.
 */
export function ExplorePage() {
  const gridOn = useFeature("exploreGrid");
  return (
    <div className="mx-auto max-w-xl space-y-3 sm:space-y-4">
      <h1 className="p-3 pb-0 text-lg font-semibold sm:p-0">Explore</h1>
      <div className="space-y-3 px-3 sm:px-0">
        <ExploreCards />
      </div>
      {gridOn && <ExploreGrid />}
    </div>
  );
}

/** Every post at one place. */
export function PlacePage() {
  const { place } = useParams({ strict: false }) as { place: string };
  const grid = useGrid();
  const posts = useQuery({
    queryKey: ["feed", "place", place],
    queryFn: () => get<FeedResponse>(`/feed?surface=place&place=${encodeURIComponent(place)}`),
  });
  return (
    <div className="mx-auto max-w-xl space-y-3 sm:space-y-4">
      <h1 className="p-3 text-lg font-semibold sm:p-0">{place}</h1>
      {posts.data?.posts.length === 0 && (
        <p className="p-6 text-center text-stone-500">No posts to show.</p>
      )}
      {grid ? (
        <PostGrid posts={posts.data?.posts ?? []} label={`Posts at ${place}`} />
      ) : (
        posts.data?.posts.map((item) => (
          <PostCard key={item.repostedBy?.id ?? item.id} post={item} surface="place" />
        ))
      )}
    </div>
  );
}

/** The posts with one hashtag. */
export function TagPage() {
  const { tag } = useParams({ strict: false }) as { tag: string };
  const posts = useQuery({
    queryKey: ["feed", "tag", tag],
    queryFn: () => get<FeedResponse>(`/feed?surface=tag&tag=${encodeURIComponent(tag)}`),
  });
  return (
    <div className="mx-auto max-w-xl space-y-3 sm:space-y-4">
      <h1 className="p-3 text-lg font-semibold sm:p-0">#{tag}</h1>
      {posts.data?.posts.length === 0 && (
        <p className="p-6 text-center text-stone-500">No posts to show.</p>
      )}
      {posts.data?.posts.map((item) => (
        <PostCard key={item.repostedBy?.id ?? item.id} post={item} surface="tag" />
      ))}
    </div>
  );
}
