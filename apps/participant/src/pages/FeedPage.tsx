import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { FeedResponse } from "@truman3/core";
import { CreatePostBar, PhotoIcon, ProfileCard } from "@truman3/ui";
import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { type FlowState, flowQuery, get, meQuery, postForm } from "../api.ts";
import { PostCard } from "../components/PostCard.tsx";

/** Picked once per page load, for studies that reshuffle the feed on each visit. */
const VISIT = Math.floor(Math.random() * 2 ** 31);

const COMPOSER = {
  photo: { placeholder: "Add a caption...", ready: (_text: boolean, image: boolean) => image },
  text: { placeholder: "What's new?", ready: (text: boolean) => text },
  mixed: { placeholder: "What's new?", ready: (text: boolean, image: boolean) => text || image },
};

/** The window for writing a post, opened from the bar at the top of the feed. */
function NewPostDialog({
  style,
  several,
  dialogRef,
}: {
  style: FlowState["platformStyle"];
  /** Whether this platform lets a post have several photos. */
  several: boolean;
  dialogRef: RefObject<HTMLDialogElement | null>;
}) {
  const client = useQueryClient();
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
    mutationFn: () => postForm("/posts", { body, image: images }),
    onSuccess: () => {
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
          disabled={create.isPending || !ready(body.trim().length > 0, images.length > 0)}
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
    queryKey: ["feed"],
    queryFn: () => get<FeedResponse>(`/feed?visit=${VISIT}`),
  });
  const flow = useQuery(flowQuery);
  const me = useQuery(meQuery);
  const newPost = useRef<HTMLDialogElement>(null);

  return (
    <div className="justify-center gap-4 md:grid md:grid-cols-[14rem_minmax(0,36rem)] lg:grid-cols-[14rem_minmax(0,36rem)_14rem]">
      {/* Too narrow on a phone, where the Profile link in the header does this job. */}
      <aside className="hidden md:block">
        {me.data && (
          <div className="sticky top-16">
            <ProfileCard
              {...me.data}
              renderName={(className, name) => (
                <Link
                  to="/u/$username"
                  params={{ username: me.data.username }}
                  className={className}
                >
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
          </div>
        )}
      </aside>
      <div className="min-w-0 space-y-3 sm:space-y-4">
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
        {feed.data?.posts.length === 0 && (
          <p className="p-6 text-center text-stone-500">No posts to show.</p>
        )}
        {feed.data?.posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}
