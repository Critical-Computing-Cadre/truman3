import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type FeedResponse, type SpaceView, textOnAccent } from "@truman3/core";
import { CreatePostBar } from "@truman3/ui";
import { useRef } from "react";
import { flowQuery, get, meQuery, post } from "../api.ts";
import { PostCard } from "../components/PostCard.tsx";
import { NewPostDialog, SortPicker } from "./FeedPage.tsx";

const spacesQuery = {
  queryKey: ["spaces"],
  queryFn: () => get<{ spaces: SpaceView[] }>("/spaces"),
};

/** A community's picture, or its first letter if it doesn't have one. */
function SpacePicture({ space }: { space: SpaceView }) {
  return space.pictureUrl ? (
    <img src={space.pictureUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
  ) : (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-stone-200 font-semibold text-stone-600">
      {space.name.charAt(0).toUpperCase()}
    </div>
  );
}

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
      style={
        !space.joined && space.accent
          ? { backgroundColor: space.accent, color: textOnAccent(space.accent) }
          : undefined
      }
      className={
        space.joined
          ? "shrink-0 rounded-full border border-stone-300 px-3 py-1 text-sm"
          : "shrink-0 rounded-full bg-stone-900 px-3 py-1 text-sm text-white"
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
            <SpacePicture space={space} />
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
  const spaces = useQuery(spacesQuery);
  const flow = useQuery(flowQuery);
  const me = useQuery(meQuery);
  const newPost = useRef<HTMLDialogElement>(null);
  const space = spaces.data?.spaces.find((item) => item.key === key);
  const feed = useQuery({
    queryKey: ["feed", "space", key],
    queryFn: () => get<FeedResponse>(`/feed?surface=space&space=${encodeURIComponent(key)}`),
  });

  if (spaces.data && !space) {
    return <p className="p-6 text-center text-stone-500">This community isn't available.</p>;
  }

  return (
    <div className="mx-auto max-w-xl space-y-3 sm:space-y-4">
      {space && (
        <section
          aria-label={space.name}
          className="overflow-hidden bg-white shadow-sm sm:rounded-lg"
        >
          {/* Nothing is written over these, so a banner or color can't make the name hard to read. */}
          {space.bannerUrl ? (
            <img src={space.bannerUrl} alt="" className="h-24 w-full object-cover sm:h-32" />
          ) : (
            space.accent && (
              <div
                data-testid="space-color"
                className="h-12 w-full"
                style={{ backgroundColor: space.accent }}
              />
            )
          )}
          <div className="flex items-start gap-3 p-3">
            <SpacePicture space={space} />
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold">{space.name}</h1>
              {space.description && (
                <p className="text-sm break-words text-stone-600">{space.description}</p>
              )}
            </div>
            <JoinButton space={space} />
          </div>
          {space.rules && (
            <div className="mx-3 mb-3 border-t border-stone-200 pt-2 text-sm">
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
      <SortPicker surface="space" sort={feed.data?.sort ?? null} />
      {feed.data?.posts.length === 0 && (
        <p className="p-6 text-center text-stone-500">No posts to show.</p>
      )}
      {feed.data?.posts.map((item) => (
        <PostCard key={item.id} post={item} surface="space" />
      ))}
    </div>
  );
}
