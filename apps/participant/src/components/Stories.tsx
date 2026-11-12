import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StoryGroup } from "@truman3/core";
import { Avatar, PlusIcon, shortTime, useFeature, useStoryLook } from "@truman3/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { get, post, postForm } from "../api.ts";

/** How long a story shows before the next, as on these platforms. */
const STORY_MS = 5000;

export const storiesQuery = {
  queryKey: ["stories"],
  queryFn: () => get<{ stories: StoryGroup[] }>("/stories"),
};

/**
 * The viewer is dark in light mode and dark mode alike, as on these platforms, so its colors are
 * written out rather than taken from the theme, which swaps white and black in dark mode.
 */
const WHITE = "text-[#fff]";
const ON_PHOTO = "drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]";

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5 fill-none stroke-current stroke-2"
    >
      <path d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

/**
 * Someone's stories, one after another, in a window over the page, as on Instagram. On a phone it
 * fills the screen. Each one seen is recorded, with where it was opened from: the row, or a
 * highlight on someone's profile.
 */
export function StoryViewer({
  groups,
  start,
  onClose,
  from = "row",
  label,
}: {
  groups: StoryGroup[];
  start: number;
  onClose: () => void;
  from?: "row" | "highlight";
  /** What the dialog is called, if not "Stories from" whoever posted them. */
  label?: string;
}) {
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [place, setPlace] = useState({ group: start, story: 0 });
  const [paused, setPaused] = useState(false);
  const shownAt = useRef(Date.now());
  // Saves of what's been seen, so the row refreshes only once they've all landed.
  const saving = useRef<Promise<unknown>[]>([]);
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
      saving.current.push(
        post(`/stories/${story.id}/viewed`, {
          dwellMs: Date.now() - shownAt.current,
          ended,
          ...(from === "highlight" ? { from } : {}),
        }).catch(() => {}),
      );
    }
    shownAt.current = Date.now();
  };
  const finish = () => {
    Promise.all(saving.current).then(() => {
      client.invalidateQueries({ queryKey: ["stories"] });
      client.invalidateQueries({ queryKey: ["actor"] });
    });
    onClose();
  };
  const close = () => {
    record("closed");
    finish();
  };
  const atStart = place.group === 0 && place.story === 0;
  const move = (step: 1 | -1, ended: "next" | "previous" | "timer") => {
    if (!group || (step === -1 && atStart)) {
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
    finish();
  };

  if (!group || !story) {
    return null;
  }
  // On a phone they sit on the story's edges, and beside it where there's room.
  const arrow = (side: string) =>
    `absolute top-1/2 ${side} z-10 flex h-9 w-9 shrink-0 -translate-y-1/2 items-center justify-center rounded-full bg-[rgb(255_255_255/0.35)] text-[#111] shadow disabled:invisible sm:static sm:translate-y-0 sm:bg-[#fff]`;
  return (
    <dialog
      ref={dialog}
      aria-label={label ?? `Stories from ${group.author.name}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          move(1, "next");
        } else if (event.key === "ArrowLeft") {
          move(-1, "previous");
        }
      }}
      className={`m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 ${WHITE} backdrop:bg-[rgb(16_16_16/0.94)]`}
    >
      {/* Clicking around the story, rather than on it, closes it. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Escape and the close button do the same */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape and the close button do the same */}
      <div
        className="relative flex h-full items-center justify-center gap-6"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            close();
          }
        }}
      >
        <button
          type="button"
          aria-label="Previous"
          disabled={atStart}
          onClick={() => move(-1, "previous")}
          className={arrow("left-2")}
        >
          <Chevron direction="left" />
        </button>
        <div
          data-testid="story-card"
          className="relative h-full w-full overflow-hidden bg-[#000] sm:aspect-[9/16] sm:h-[min(92dvh,52rem)] sm:w-auto sm:rounded-xl"
        >
          {/* The same photo, blurred, fills what the photo itself doesn't, as these platforms do. */}
          <img
            src={story.imageUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl"
          />
          <img
            src={story.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-contain"
          />
          {/* Tapping the left third goes back, and the rest goes on, as on these platforms. The
              arrows do the same for a keyboard or screen reader. */}
          <div
            aria-hidden="true"
            onClick={() => move(-1, "previous")}
            className="absolute inset-y-0 left-0 w-1/3"
          />
          <div
            aria-hidden="true"
            onClick={() => move(1, "next")}
            className="absolute inset-y-0 right-0 w-2/3"
          />

          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-[rgb(0_0_0/0.55)] to-transparent px-3 pt-3 pb-8">
            <div className="flex gap-1" aria-hidden="true">
              {group.stories.map((item, index) => (
                <span
                  key={item.id}
                  className="h-0.5 flex-1 overflow-hidden rounded bg-[rgb(255_255_255/0.4)]"
                >
                  {index < place.story && <span className="block h-full w-full bg-[#fff]" />}
                  {index === place.story && (
                    <span
                      key={story.id}
                      data-testid="story-progress"
                      className="block h-full bg-[#fff]"
                      style={{
                        animation: `story-fill ${STORY_MS}ms linear forwards`,
                        animationPlayState: paused ? "paused" : "running",
                      }}
                      onAnimationEnd={() => move(1, "timer")}
                    />
                  )}
                </span>
              ))}
            </div>
            <div className={`mt-3 flex items-center gap-2 text-sm ${ON_PHOTO}`}>
              <Avatar seed={group.author.username} url={group.author.pictureUrl} size="h-8 w-8" />
              <span className="truncate font-semibold">{group.author.name}</span>
              <span className="shrink-0 text-[rgb(255_255_255/0.75)]">{shortTime(story.at)}</span>
              {story.closeFriends && (
                <span className="shrink-0 rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold">
                  Close friends
                </span>
              )}
              <button
                type="button"
                onClick={() => setPaused(!paused)}
                aria-label={paused ? "Play" : "Pause"}
                className="relative z-10 ml-auto px-1"
              >
                {paused ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
                    <path d="M7 4v16l13-8z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-current">
                    <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={close}
                className="relative z-10 px-1 text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
          </div>

          {(story.caption || group.author.isViewer) && (
            <div
              className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[rgb(0_0_0/0.6)] to-transparent px-4 pt-10 pb-5 text-center ${ON_PHOTO}`}
            >
              {story.caption && <p className="break-words">{story.caption}</p>}
              {group.author.isViewer && (
                <p
                  data-testid="story-viewers"
                  className="mt-2 text-sm text-[rgb(255_255_255/0.85)]"
                >
                  {viewers.data?.viewers.length
                    ? `Seen by ${viewers.data.viewers.map(({ name }) => name).join(", ")}`
                    : "No views yet"}
                </p>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Next"
          onClick={() => move(1, "next")}
          className={arrow("right-2")}
        >
          <Chevron direction="right" />
        </button>
      </div>
    </dialog>
  );
}

function NewStory({ onDone }: { onDone: () => void }) {
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [audience, setAudience] = useState<"everyone" | "closeFriends">("everyone");
  const closeFriendsOn = useFeature("closeFriends");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const send = useMutation({
    mutationFn: () =>
      postForm("/stories", {
        image: file as File,
        caption,
        ...(closeFriendsOn ? { audience } : {}),
      }),
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
        {closeFriendsOn && (
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1 font-medium">Who can see it</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                checked={audience === "everyone"}
                onChange={() => setAudience("everyone")}
              />
              Everyone
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="audience"
                checked={audience === "closeFriends"}
                onChange={() => setAudience("closeFriends")}
              />
              Close friends only
            </label>
          </fieldset>
        )}
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
            className="rounded bg-accent-fill px-3 py-1.5 text-on-accent disabled:opacity-40"
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
  const look = useStoryLook();
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const groups = stories.data?.stories ?? [];
  const hasOwn = groups[0]?.author.isViewer ?? false;
  if (groups.length === 0 && !canPost) {
    return null;
  }
  const label = (group: StoryGroup) =>
    group.author.isViewer
      ? "Your story"
      : `Stories from ${group.author.name}${group.closeFriends ? ", close friends" : ""}${group.allSeen ? ", seen" : ""}`;
  const ring = (group: StoryGroup) =>
    group.allSeen
      ? "bg-stone-300"
      : group.closeFriends
        ? "bg-green-500"
        : "bg-gradient-to-tr from-amber-400 to-fuchsia-600";
  if (look === "cards") {
    return (
      <section aria-label="Stories" className="overflow-x-auto">
        <ul className="flex gap-2 px-3 sm:px-0">
          {canPost && me && !hasOwn && (
            <li className="shrink-0">
              <button
                type="button"
                onClick={() => setAdding(true)}
                aria-label="Add to your story"
                className="flex h-48 w-28 flex-col overflow-hidden rounded-xl bg-white text-xs font-semibold shadow-sm"
              >
                <span className="flex flex-1 items-center justify-center bg-stone-100">
                  <Avatar seed={me.username} url={me.pictureUrl} size="h-16 w-16" />
                </span>
                <span className="relative pt-5 pb-2">
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full border-4 border-white bg-white text-accent">
                    <PlusIcon className="h-6 w-6" />
                  </span>
                  Create story
                </span>
              </button>
            </li>
          )}
          {groups.map((group, index) => {
            const latest = group.stories.at(-1);
            return (
              <li key={group.author.username} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setOpen(index)}
                  aria-label={label(group)}
                  className="relative block h-48 w-28 overflow-hidden rounded-xl bg-stone-300 text-left shadow-sm"
                >
                  {latest && (
                    <img src={latest.imageUrl} alt="" className="h-full w-full object-cover" />
                  )}
                  <span className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60" />
                  <span className={`absolute top-2 left-2 rounded-full p-[2px] ${ring(group)}`}>
                    <span className="block rounded-full bg-white p-[1px]">
                      <Avatar
                        seed={group.author.username}
                        url={group.author.pictureUrl}
                        size="h-8 w-8"
                      />
                    </span>
                  </span>
                  <span className="absolute inset-x-2 bottom-2 truncate text-xs font-semibold text-white">
                    {group.author.isViewer ? "Your story" : group.author.name}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {open !== null && (
          <StoryViewer groups={groups} start={open} onClose={() => setOpen(null)} />
        )}
        {adding && <NewStory onDone={() => setAdding(false)} />}
      </section>
    );
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
                <span className="absolute -right-1 -bottom-1 rounded-full bg-white text-accent">
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
              aria-label={label(group)}
              className="flex w-full flex-col items-center gap-1 text-xs"
            >
              <span className={`rounded-full p-[2px] ${ring(group)}`}>
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
