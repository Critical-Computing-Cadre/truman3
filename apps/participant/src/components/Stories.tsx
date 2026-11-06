import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StoryGroup } from "@truman3/core";
import { Avatar, PlusIcon } from "@truman3/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { get, post, postForm } from "../api.ts";

/** How long a story shows before the next, as on these platforms. */
const STORY_MS = 5000;

export const storiesQuery = {
  queryKey: ["stories"],
  queryFn: () => get<{ stories: StoryGroup[] }>("/stories"),
};

/** One person's stories, full screen, one after another. Each one seen is recorded. */
function StoryViewer({
  groups,
  start,
  onClose,
}: {
  groups: StoryGroup[];
  start: number;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [place, setPlace] = useState({ group: start, story: 0 });
  const shownAt = useRef(Date.now());
  const group = groups[place.group];
  const story = group?.stories[place.story];

  const viewers = useQuery({
    queryKey: ["story-viewers", story?.id],
    enabled: Boolean(group?.author.isViewer && story),
    queryFn: () =>
      get<{ viewers: { username: string; name: string }[] }>(`/stories/${story?.id}/viewers`),
  });

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const record = (ended: "next" | "previous" | "closed" | "timer") => {
    if (story && !group?.author.isViewer) {
      post(`/stories/${story.id}/viewed`, { dwellMs: Date.now() - shownAt.current, ended }).catch(
        () => {},
      );
    }
    shownAt.current = Date.now();
  };
  const close = () => {
    record("closed");
    client.invalidateQueries({ queryKey: ["stories"] });
    onClose();
  };
  const move = (step: 1 | -1, ended: "next" | "previous" | "timer") => {
    if (!group) {
      return;
    }
    record(ended);
    const nextStory = place.story + step;
    if (nextStory >= 0 && nextStory < group.stories.length) {
      setPlace({ group: place.group, story: nextStory });
      return;
    }
    const nextGroup = place.group + step;
    if (nextGroup >= 0 && nextGroup < groups.length) {
      setPlace({
        group: nextGroup,
        story: step === 1 ? 0 : (groups[nextGroup]?.stories.length ?? 1) - 1,
      });
      return;
    }
    client.invalidateQueries({ queryKey: ["stories"] });
    onClose();
  };

  useEffect(() => {
    if (!story) {
      return;
    }
    const timer = setTimeout(() => move(1, "timer"), STORY_MS);
    return () => clearTimeout(timer);
  });

  if (!group || !story) {
    return null;
  }
  return (
    <dialog
      ref={dialog}
      aria-label={`Stories from ${group.author.name}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-stone-950 text-white backdrop:bg-black"
    >
      <div className="relative mx-auto flex h-full max-w-md flex-col">
        <div className="flex gap-1 px-3 pt-3">
          {group.stories.map((item, index) => (
            <span
              key={item.id}
              className={`h-0.5 flex-1 rounded ${index <= place.story ? "bg-white" : "bg-white/40"}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 px-3 py-2 text-sm">
          <Avatar seed={group.author.username} url={group.author.pictureUrl} size="h-8 w-8" />
          <span className="font-semibold">{group.author.name}</span>
          <button
            type="button"
            onClick={close}
            className="ml-auto px-2 text-2xl"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center">
          <img src={story.imageUrl} alt="" className="max-h-full max-w-full object-contain" />
          <button
            type="button"
            aria-label="Previous"
            onClick={() => move(-1, "previous")}
            className="absolute inset-y-0 left-0 w-1/3"
          />
          <button
            type="button"
            aria-label="Next"
            onClick={() => move(1, "next")}
            className="absolute inset-y-0 right-0 w-2/3"
          />
        </div>
        {story.caption && <p className="px-4 py-3 text-center">{story.caption}</p>}
        {group.author.isViewer && (
          <p data-testid="story-viewers" className="px-4 pb-4 text-sm text-white/80">
            {viewers.data?.viewers.length
              ? `Seen by ${viewers.data.viewers.map(({ name }) => name).join(", ")}`
              : "No views yet"}
          </p>
        )}
      </div>
    </dialog>
  );
}

/** Posting a story: one photo, and a few words if they like. */
function NewStory({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const send = useMutation({
    mutationFn: () => postForm("/stories", { image: file as File, caption }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["stories"] });
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send.mutate();
  };
  return (
    <dialog
      ref={dialog}
      aria-label="Add to your story"
      onClose={onDone}
      className="m-auto w-[min(92vw,24rem)] rounded-lg backdrop:bg-black/50"
    >
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        <h2 className="text-lg font-semibold">Add to your story</h2>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Photo
          <input
            type="file"
            accept="image/*"
            required
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Caption (optional)
          <input
            value={caption}
            maxLength={500}
            onChange={(event) => setCaption(event.target.value)}
            className="rounded border border-stone-300 px-2 py-1.5 font-normal"
          />
        </label>
        {send.isError && (
          <p role="alert" className="text-sm text-rose-700">
            {send.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => dialog.current?.close()} className="px-3 py-1.5">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!file || send.isPending}
            className="rounded bg-stone-900 px-3 py-1.5 text-white disabled:opacity-40"
          >
            Share
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Stories in a row, with a ring around anyone's not yet seen, and the way to add one's own. */
export function StoriesRow({
  canPost,
  me,
}: {
  canPost: boolean;
  me?: { username: string; pictureUrl: string | null };
}) {
  const stories = useQuery(storiesQuery);
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const groups = stories.data?.stories ?? [];
  const hasOwn = groups[0]?.author.isViewer ?? false;
  if (groups.length === 0 && !canPost) {
    return null;
  }
  return (
    <section aria-label="Stories" className="overflow-x-auto bg-white py-3 sm:rounded-lg">
      <ul className="flex gap-3 px-3">
        {canPost && me && !hasOwn && (
          <li className="w-16 shrink-0 text-center">
            <button
              type="button"
              onClick={() => setAdding(true)}
              aria-label="Add to your story"
              className="flex w-full flex-col items-center gap-1 text-xs"
            >
              <span className="relative">
                <Avatar seed={me.username} url={me.pictureUrl} size="h-14 w-14" />
                <span className="absolute -right-1 -bottom-1 rounded-full bg-white text-sky-600">
                  <PlusIcon className="h-5 w-5" />
                </span>
              </span>
              Your story
            </button>
          </li>
        )}
        {groups.map((group, index) => (
          <li key={group.author.username} className="w-16 shrink-0 text-center">
            <button
              type="button"
              onClick={() => setOpen(index)}
              aria-label={
                group.author.isViewer
                  ? "Your story"
                  : `Stories from ${group.author.name}${group.allSeen ? ", seen" : ""}`
              }
              className="flex w-full flex-col items-center gap-1 text-xs"
            >
              <span
                className={`rounded-full p-[2px] ${group.allSeen ? "bg-stone-300" : "bg-gradient-to-tr from-amber-400 to-fuchsia-600"}`}
              >
                <span className="block rounded-full bg-white p-[2px]">
                  <Avatar
                    seed={group.author.username}
                    url={group.author.pictureUrl}
                    size="h-14 w-14"
                  />
                </span>
              </span>
              <span className="w-full truncate">
                {group.author.isViewer ? "Your story" : group.author.username}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open !== null && <StoryViewer groups={groups} start={open} onClose={() => setOpen(null)} />}
      {adding && <NewStory onDone={() => setAdding(false)} />}
    </section>
  );
}
