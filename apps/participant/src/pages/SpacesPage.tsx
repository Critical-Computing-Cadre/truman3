import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { FeedResponse, SpaceView } from "@truman3/core";
import { CreatePostBar } from "@truman3/ui";
import { useRef, useState } from "react";
import { flowQuery, get, meQuery, post } from "../api.ts";
import { PostCard } from "../components/PostCard.tsx";
import { type FeedSort, NewPostDialog, SortPicker } from "./FeedPage.tsx";

const spacesQuery = {
  queryKey: ["spaces"],
  queryFn: () => get<{ spaces: SpaceView[] }>("/spaces"),
};

/** Joining or leaving, on a study that lets people choose. Each one is recorded. */
function JoinButton({ space }: { space: SpaceView }) {
  const client = useQueryClient();
  const flow = useQuery(flowQuery);
  const change = useMutation({
    mutationFn: () => post(`/spaces/${space.key}/membership`, { joined: !space.joined }),
    onSettled: () => client.invalidateQueries(),
  });
  if (!flow.data?.canJoinSpaces) {
    return null;
  }
  return (
    <button
      type="button"
      disabled={change.isPending}
      onClick={() => change.mutate()}
      className={
        space.joined
          ? "shrink-0 rounded border border-stone-300 px-3 py-1 text-sm"
          : "shrink-0 rounded bg-stone-900 px-3 py-1 text-sm text-white"
      }
    >
      {space.joined ? "Leave" : "Join"}
    </button>
  );
}

/** The communities on this platform. */
export function SpacesPage() {
  const spaces = useQuery(spacesQuery);
  return (
    <div className="mx-auto max-w-xl space-y-3 p-3 sm:p-0">
      <h1 className="text-lg font-semibold">Communities</h1>
      {spaces.data?.spaces.length === 0 && (
        <p className="p-6 text-center text-stone-500">No communities to show.</p>
      )}
      <ul className="space-y-2">
        {spaces.data?.spaces.map((space) => (
          <li
            key={space.key}
            aria-label={space.name}
            className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-sm"
          >
            <div className="min-w-0 flex-1">
              <Link
                to="/spaces/$key"
                params={{ key: space.key }}
                className="font-semibold underline-offset-2 hover:underline"
              >
                {space.name}
              </Link>
              {space.description && (
                <p className="text-sm break-words text-stone-600">{space.description}</p>
              )}
            </div>
            <JoinButton space={space} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One community's page: what it is, its rules, and its posts. */
export function SpacePage() {
  const { key } = useParams({ from: "/gate/spaces/$key" });
  const [sort, setSort] = useState<FeedSort>(null);
  const spaces = useQuery(spacesQuery);
  const flow = useQuery(flowQuery);
  const me = useQuery(meQuery);
  const newPost = useRef<HTMLDialogElement>(null);
  const space = spaces.data?.spaces.find((item) => item.key === key);
  const feed = useQuery({
    queryKey: ["feed", "space", key, sort],
    queryFn: () =>
      get<FeedResponse>(
        `/feed?surface=space&space=${encodeURIComponent(key)}${sort ? `&sort=${sort}` : ""}`,
      ),
  });

  if (spaces.data && !space) {
    return <p className="p-6 text-center text-stone-500">This community isn't available.</p>;
  }

  return (
    <div className="mx-auto max-w-xl space-y-3 sm:space-y-4">
      {space && (
        <section aria-label={space.name} className="bg-white p-3 shadow-sm sm:rounded-lg">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold">{space.name}</h1>
              {space.description && (
                <p className="text-sm break-words text-stone-600">{space.description}</p>
              )}
            </div>
            <JoinButton space={space} />
          </div>
          {space.rules && (
            <div className="mt-2 border-t border-stone-200 pt-2 text-sm">
              <h2 className="font-medium">Rules</h2>
              <p className="break-words whitespace-pre-wrap text-stone-700">{space.rules}</p>
            </div>
          )}
        </section>
      )}
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
            space={key}
          />
        </>
      )}
      <SortPicker surface="space" sort={sort} onChange={setSort} />
      {feed.data?.posts.length === 0 && (
        <p className="p-6 text-center text-stone-500">No posts to show.</p>
      )}
      {feed.data?.posts.map((item) => (
        <PostCard key={item.id} post={item} surface="space" />
      ))}
    </div>
  );
}
