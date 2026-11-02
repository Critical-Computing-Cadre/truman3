import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedResponse } from "@truman3/core";
import { type FormEvent, useRef, useState } from "react";
import { type FlowState, get, postForm } from "../api.ts";
import { PostCard } from "../components/PostCard.tsx";

/** Picked once per page load, for studies that reshuffle the feed on each visit. */
const VISIT = Math.floor(Math.random() * 2 ** 31);

const COMPOSER = {
  photo: { placeholder: "Add a caption...", ready: (_text: boolean, image: boolean) => image },
  text: { placeholder: "What's new?", ready: (text: boolean) => text },
  mixed: { placeholder: "What's new?", ready: (text: boolean, image: boolean) => text || image },
};

function Composer({ style }: { style: FlowState["platformStyle"] }) {
  const client = useQueryClient();
  const [body, setBody] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const { placeholder, ready } = COMPOSER[style];
  const fileInput = useRef<HTMLInputElement>(null);

  const create = useMutation({
    mutationFn: () => postForm("/posts", { body, ...(image ? { image } : {}) }),
    onSuccess: () => {
      setBody("");
      setImage(null);
      if (fileInput.current) {
        fileInput.current.value = "";
      }
    },
    onSettled: () => client.invalidateQueries(),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-2 bg-white p-3 shadow-sm sm:rounded-lg">
      <textarea
        aria-label="Write a post"
        rows={2}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-stone-300 px-3 py-2 text-base"
      />
      <div className="flex items-center justify-between gap-2">
        {style !== "text" && (
          <input
            ref={fileInput}
            aria-label="Add a photo"
            type="file"
            accept="image/*"
            onChange={(event) => setImage(event.target.files?.[0] ?? null)}
            className="min-w-0 text-sm"
          />
        )}
        <button
          type="submit"
          disabled={create.isPending || !ready(body.trim().length > 0, image !== null)}
          className="ml-auto rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          Post
        </button>
      </div>
      {create.error && (
        <p role="alert" className="text-sm text-rose-700">
          {create.error.message}
        </p>
      )}
    </form>
  );
}

export function FeedPage() {
  const feed = useQuery({
    queryKey: ["feed"],
    queryFn: () => get<FeedResponse>(`/feed?visit=${VISIT}`),
  });
  const flow = useQuery({ queryKey: ["flow"], queryFn: () => get<FlowState>("/me/flow") });

  return (
    <div className="space-y-3 sm:space-y-4">
      {flow.data && <Composer style={flow.data.platformStyle} />}
      {feed.data?.posts.length === 0 && (
        <p className="p-6 text-center text-stone-500">No posts to show.</p>
      )}
      {feed.data?.posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}
