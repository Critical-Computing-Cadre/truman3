import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { FeedResponse } from "@truman3/core";
import { Avatar } from "@truman3/ui";
import { get, post } from "../api.ts";
import { PostCard } from "../components/PostCard.tsx";

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
  return (
    <>
      {trending.length > 0 && (
        <section aria-label="Trending" className={CARD}>
          <h2 className="mb-2 font-semibold">Trending</h2>
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
        <section aria-label="Who to follow" className={CARD}>
          <h2 className="mb-2 font-semibold">Who to follow</h2>
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
                  className="rounded-full border border-stone-300 px-3 py-1 text-sm"
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

/** Where a phone reaches what a wide screen shows beside the feed. */
export function ExplorePage() {
  return (
    <div className="mx-auto max-w-xl space-y-3 p-3 sm:p-0">
      <h1 className="text-lg font-semibold">Explore</h1>
      <ExploreCards />
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
