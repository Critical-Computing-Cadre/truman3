import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  type FeedSort as ChosenSort,
  FEED_SORTS,
  type FeedResponse,
  MAX_TITLE_LENGTH,
  SORT_LABELS,
  type SpaceView,
} from "@truman3/core";
import { CreatePostBar, FeedFrame, PhotoIcon, ProfileCard } from "@truman3/ui";
import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { type FlowState, flowQuery, get, meQuery, post, postForm } from "../api.ts";
import { CommunitiesCard } from "../components/Community.tsx";
import { PostCard } from "../components/PostCard.tsx";

/** Picked once per page load, for studies that reshuffle the feed on each visit. */
const VISIT = Math.floor(Math.random() * 2 ** 31);

const COMPOSER = {
  photo: { placeholder: "Add a caption...", ready: (_text: boolean, image: boolean) => image },
  text: { placeholder: "What's new?", ready: (text: boolean) => text },
  mixed: { placeholder: "What's new?", ready: (text: boolean, image: boolean) => text || image },
};

export type FeedSort = ChosenSort | null;

/** Lets someone choose the order, on a study that allows it. Each choice is recorded. */
export function SortPicker({
  surface,
  sort,
}: {
  surface: "home" | "space";
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

/** The window for writing a post, opened from the bar at the top of the feed. */
export function NewPostDialog({
  style,
  several,
  dialogRef,
  space,
}: {
  style: FlowState["platformStyle"];
  /** Whether this platform lets a post have several photos. */
  several: boolean;
  dialogRef: RefObject<HTMLDialogElement | null>;
  /** The key of the space this goes in, when writing from a space's page. */
  space?: string;
}) {
  const client = useQueryClient();
  const flow = useQuery(flowQuery);
  const titles = flow.data?.features.titles ?? false;
  const chooseSpace = !space && (flow.data?.features.spaces ?? false);
  const spaces = useQuery({
    queryKey: ["spaces"],
    queryFn: () => get<{ spaces: SpaceView[] }>("/spaces"),
    enabled: chooseSpace,
  });
  const [title, setTitle] = useState("");
  const [chosenSpace, setChosenSpace] = useState("");
  const [body, setBody] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const image = images[0];
  const { placeholder, ready } = COMPOSER[style];
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!image) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const close = () => dialogRef.current?.close();

  const create = useMutation({
    mutationFn: () => {
      const where = space ?? chosenSpace;
      return postForm("/posts", {
        ...(titles ? { title } : {}),
        body,
        image: images,
        ...(where ? { space: where } : {}),
      });
    },
    onSuccess: () => {
      setTitle("");
      setChosenSpace("");
      setBody("");
      setImages([]);
      if (fileInput.current) {
        fileInput.current.value = "";
      }
      close();
    },
    onSettled: () => client.invalidateQueries(),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="new-post-title"
      className="m-auto max-h-[90dvh] w-[min(92vw,28rem)] overflow-y-auto rounded-lg backdrop:bg-black/50"
    >
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h2 id="new-post-title" className="text-lg font-semibold">
            Add a New Post
          </h2>
          <button type="button" aria-label="Close" onClick={close} className="px-2 text-xl">
            ×
          </button>
        </div>
        {chooseSpace && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Community
            <select
              value={chosenSpace}
              onChange={(event) => setChosenSpace(event.target.value)}
              className="rounded border border-stone-300 bg-white px-2 py-2 text-base font-normal"
            >
              <option value="">No community</option>
              {spaces.data?.spaces.map(({ key, name }) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        {titles && (
          <input
            aria-label="Title"
            required
            maxLength={MAX_TITLE_LENGTH}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title"
            className="w-full rounded border border-stone-300 px-3 py-2 text-base font-semibold"
          />
        )}
        <textarea
          aria-label="Write a post"
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={placeholder}
          className="w-full rounded border border-stone-300 px-3 py-2 text-base"
        />
        {style !== "text" && (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed border-stone-300 p-4 text-sm text-stone-500 focus-within:outline-2">
            {imageUrl ? (
              <img src={imageUrl} alt="Your chosen" className="max-h-64 rounded object-contain" />
            ) : (
              <PhotoIcon className="h-10 w-10" />
            )}
            {images.length > 1 && <span>{images.length} photos chosen</span>}
            {imageUrl
              ? `Choose ${several ? "different photos" : "a different photo"}`
              : `Add ${several ? "photos" : "a photo"}`}
            <input
              ref={fileInput}
              aria-label={several ? "Add photos" : "Add a photo"}
              type="file"
              accept="image/*"
              multiple={several}
              onChange={(event) => setImages([...(event.target.files ?? [])])}
              className="sr-only"
            />
          </label>
        )}
        {create.error && (
          <p role="alert" className="text-sm text-rose-700">
            {create.error.message}
          </p>
        )}
        <button
          type="submit"
          disabled={
            create.isPending ||
            !ready(body.trim().length > 0, images.length > 0) ||
            (titles && !title.trim())
          }
          className="rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          Post
        </button>
      </form>
    </dialog>
  );
}

export function FeedPage() {
  const feed = useQuery({
    queryKey: ["feed", "home"],
    queryFn: () => get<FeedResponse>(`/feed?visit=${VISIT}`),
  });
  const flow = useQuery(flowQuery);
  const me = useQuery(meQuery);
  const newPost = useRef<HTMLDialogElement>(null);

  return (
    <FeedFrame
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
      side={flow.data?.features.spaces ? <CommunitiesCard /> : undefined}
    >
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
      {feed.data && <SortPicker surface="home" sort={feed.data.sort ?? null} />}
      {feed.data?.posts.length === 0 && (
        <p className="p-6 text-center text-stone-500">No posts to show.</p>
      )}
      {feed.data?.posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </FeedFrame>
  );
}
