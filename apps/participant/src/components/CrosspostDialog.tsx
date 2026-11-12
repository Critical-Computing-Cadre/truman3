import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FeedPost, MAX_TITLE_LENGTH } from "@truman3/core";
import { type FormEvent, type RefObject, useState } from "react";
import { flowQuery, post as send } from "../api.ts";
import { spacesQuery } from "./Community.tsx";

/** The window for sharing a post into another community someone has joined. */
export function CrosspostDialog({
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
  const spaces = useQuery(spacesQuery);
  const titles = flow.data?.features.titles ?? false;
  const fromKey = post.crosspost?.original?.space?.key;
  const choices = (spaces.data?.spaces ?? []).filter(
    ({ joined, key }) => joined && key !== post.space?.key && key !== fromKey,
  );
  const [spaceKey, setSpaceKey] = useState("");
  const [title, setTitle] = useState(post.title ?? "");
  const [flair, setFlair] = useState("");
  const chosen = choices.find(({ key }) => key === spaceKey);

  const create = useMutation({
    mutationFn: () =>
      send(`/content/${post.id}/crosspost`, {
        space: spaceKey,
        ...(titles && title.trim() ? { title } : {}),
        ...(flair ? { flair } : {}),
      }),
    onSuccess: () => dialogRef.current?.close(),
    onSettled: () => client.invalidateQueries(),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`crosspost-${post.id}`}
      onClose={onClose}
      className="m-auto max-h-[90dvh] w-[min(92vw,28rem)] overflow-y-auto rounded-lg backdrop:bg-black/50"
    >
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h2 id={`crosspost-${post.id}`} className="text-lg font-semibold">
            Crosspost
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
        {spaces.data && choices.length === 0 ? (
          <p className="text-sm text-stone-600">
            There's no other community you've joined to share this into.
          </p>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Community
              <select
                required
                value={spaceKey}
                onChange={(event) => {
                  setSpaceKey(event.target.value);
                  setFlair("");
                }}
                className="rounded border border-stone-300 bg-white px-2 py-2 text-base font-normal"
              >
                <option value="">Choose one</option>
                {choices.map(({ key, name }) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
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
            {chosen && chosen.postFlair.length > 0 && (
              <label className="flex flex-col gap-1 text-sm font-medium">
                Flair
                <select
                  required={chosen.requirePostFlair}
                  value={flair}
                  onChange={(event) => setFlair(event.target.value)}
                  className="rounded border border-stone-300 bg-white px-2 py-2 text-base font-normal"
                >
                  <option value="">{chosen.requirePostFlair ? "Choose one" : "None"}</option>
                  {chosen.postFlair.map(({ text }) => (
                    <option key={text} value={text}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {create.error && (
              <p role="alert" className="text-sm text-rose-700">
                {create.error.message}
              </p>
            )}
            <button
              type="submit"
              disabled={create.isPending || !spaceKey}
              className="rounded bg-accent-fill px-4 py-2 text-sm text-on-accent disabled:opacity-40"
            >
              Crosspost
            </button>
          </>
        )}
      </form>
    </dialog>
  );
}
