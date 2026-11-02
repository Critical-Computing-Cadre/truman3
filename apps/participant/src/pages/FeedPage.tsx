import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedResponse } from "@truman3/core";
import { type FormEvent, useRef, useState } from "react";
import { get, postForm } from "../api.ts";
import { PostCard } from "../components/PostCard.tsx";

function Composer() {
  const client = useQueryClient();
  const [body, setBody] = useState("");
  const [image, setImage] = useState<File | null>(null);
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
        placeholder="What's new?"
        className="w-full rounded border border-stone-300 px-3 py-2 text-base"
      />
      <div className="flex items-center justify-between gap-2">
        <input
          ref={fileInput}
          aria-label="Add a photo"
          type="file"
          accept="image/*"
          onChange={(event) => setImage(event.target.files?.[0] ?? null)}
          className="min-w-0 text-sm"
        />
        <button
          type="submit"
          disabled={create.isPending || (!body.trim() && !image)}
          className="rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-40"
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
  const feed = useQuery({ queryKey: ["feed"], queryFn: () => get<FeedResponse>("/feed") });

  return (
    <div className="space-y-3 sm:space-y-4">
      <Composer />
      {feed.data?.posts.length === 0 && (
        <p className="p-6 text-center text-stone-500">No posts to show.</p>
      )}
      {feed.data?.posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}
