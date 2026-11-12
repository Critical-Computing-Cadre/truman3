import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeedPost } from "@truman3/core";
import { type FormEvent, type RefObject, useState } from "react";
import { flowQuery, postForm, type Written } from "../api.ts";
import { AreYouSure } from "./AreYouSure.tsx";

/** The window for writing a post that shows another post inside it. */
export function QuoteDialog({
  post,
  dialogRef,
  onClose,
}: {
  post: FeedPost;
  dialogRef: RefObject<HTMLDialogElement | null>;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const flow = useQuery(flowQuery);
  const limit = flow.data?.maxPostLength ?? null;
  const [body, setBody] = useState("");
  const [asked, setAsked] = useState<NonNullable<Written["confirm"]> | null>(null);

  const create = useMutation({
    mutationFn: (confirmedRule?: string) =>
      postForm<Written>("/posts", {
        body,
        quoteOf: post.id,
        ...(confirmedRule ? { confirmedRule } : {}),
      }),
    onSuccess: (written) => {
      if (written.confirm) {
        setAsked(written.confirm);
        return;
      }
      dialogRef.current?.close();
    },
    onSettled: () => client.invalidateQueries(),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(undefined);
  };
  const tooLong = limit !== null && body.trim().length > limit;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`quote-${post.id}`}
      onClose={onClose}
      className="m-auto max-h-[90dvh] w-[min(92vw,28rem)] overflow-y-auto rounded-lg backdrop:bg-black/50"
    >
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h2 id={`quote-${post.id}`} className="text-lg font-semibold">
            Quote this post
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => dialogRef.current?.close()}
            className="px-2 text-xl"
          >
            ×
          </button>
        </div>
        {asked && (
          <AreYouSure
            asked={asked}
            sending={create.isPending}
            onPost={() => create.mutate(asked.rule)}
            onBack={() => setAsked(null)}
          />
        )}
        <label className="flex flex-col gap-1 text-sm font-medium">
          What do you want to say?
          <textarea
            required
            rows={3}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="rounded border border-stone-300 p-2 text-base font-normal"
          />
        </label>
        {limit !== null && (
          <p
            data-testid="length-left"
            className={`text-xs ${tooLong ? "text-rose-700" : "text-stone-500"}`}
          >
            {limit - body.trim().length} characters left
          </p>
        )}
        <div className="rounded-lg border border-stone-200 p-2 text-sm">
          <p className="text-xs font-semibold">{post.author.name}</p>
          <p className="line-clamp-3 whitespace-pre-wrap">{post.title ?? post.body}</p>
        </div>
        {create.isError && (
          <p role="alert" className="text-sm text-rose-700">
            {create.error.message}
          </p>
        )}
        <button
          type="submit"
          disabled={create.isPending || !body.trim() || tooLong}
          className="rounded bg-accent-fill px-3 py-2 text-on-accent disabled:opacity-40"
        >
          Post
        </button>
      </form>
    </dialog>
  );
}
