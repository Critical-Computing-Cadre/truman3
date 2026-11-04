import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { FeedResponse } from "@truman3/core";
import { CreatePostBar, SpaceFrame } from "@truman3/ui";
import { useRef } from "react";
import { flowQuery, get, meQuery } from "../api.ts";
import {
  JoinButton,
  MemberCount,
  SpacePicture,
  spacesQuery,
  UserFlairPicker,
} from "../components/Community.tsx";
import { PostCard } from "../components/PostCard.tsx";
import { NewPostDialog, SortPicker } from "./FeedPage.tsx";

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
              <MemberCount space={space} />
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

  const posts = (
    <>
      {space && space.joined && space.userFlair.length > 0 && (
        <div className="px-3 sm:px-0">
          <UserFlairPicker space={space} />
        </div>
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
      {feed.data && <SortPicker surface="space" sort={feed.data.sort ?? null} />}
      {feed.data?.posts.length === 0 && (
        <p className="p-6 text-center text-stone-500">No posts to show.</p>
      )}
      {feed.data?.posts.map((item) => (
        <PostCard key={item.id} post={item} surface="space" />
      ))}
    </>
  );

  if (!space) {
    return <div className="mx-auto max-w-xl space-y-3 sm:space-y-4">{posts}</div>;
  }
  return (
    <SpaceFrame
      label={space.name}
      bannerUrl={space.bannerUrl}
      accent={space.accent}
      picture={<SpacePicture space={space} />}
      name={space.name}
      description={space.description}
      members={<MemberCount space={space} />}
      join={<JoinButton space={space} />}
      rules={space.rules}
    >
      {posts}
    </SpaceFrame>
  );
}
