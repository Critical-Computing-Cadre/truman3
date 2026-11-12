import type { FormEvent, KeyboardEvent, ReactNode, Ref } from "react";
import { Avatar } from "./Avatar.tsx";
import { Decor, useChrome, useDecor } from "./chrome.tsx";
import { KarmaBadge } from "./features/karma.tsx";
import { PenIcon, PlusIcon } from "./icons.tsx";
import { usePlatform } from "./platform.tsx";

export function PhotoIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="m4 17 5-4 3 2 4-4 4 4" />
    </svg>
  );
}

/** Looks like a box to type in, and opens the window for writing a post. */
export function CreatePostBar({
  seed,
  pictureUrl,
  showPhoto,
  onOpen,
}: {
  seed: string;
  pictureUrl: string | null;
  showPhoto: boolean;
  /** Leave this out to show a bar that can't be used, as in a preview. */
  onOpen?: () => void;
}) {
  const { layout } = usePlatform();
  const decor = useDecor();
  const first = useChrome()?.viewer?.name.split(" ")[0];
  // Whatever it looks like, it's one button with one name, so it reads the same aloud everywhere.
  const button = { type: "button", disabled: !onOpen, onClick: onOpen } as const;
  const name = "Create a post";

  if (layout === "photo") {
    // A photo app has no box to type in. Starting a post is one small button.
    return (
      <button
        {...button}
        aria-label={name}
        className="flex w-full items-center gap-2 px-3 py-1 text-sm font-semibold text-accent sm:px-0"
      >
        <PlusIcon className="h-6 w-6" />
        New post
      </button>
    );
  }
  if (layout === "short-posts") {
    return (
      <div className="flex items-center gap-3 border-b border-stone-200 bg-white p-3">
        <Avatar seed={seed} url={pictureUrl} />
        <button
          {...button}
          aria-label={name}
          className="flex min-w-0 flex-1 items-center justify-between text-left text-lg text-stone-500"
        >
          What's up?
          <span className="rounded-full bg-accent-fill px-4 py-1.5 text-sm font-bold text-on-accent">
            Post
          </span>
        </button>
      </div>
    );
  }
  if (layout === "forum") {
    return (
      <div className="flex items-center gap-2 border-b border-stone-200 bg-white p-3 sm:rounded-xl sm:border">
        <Avatar seed={seed} url={pictureUrl} size="h-9 w-9" />
        <button
          {...button}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-left text-sm text-stone-500 hover:border-accent"
        >
          <PenIcon className="h-4 w-4" />
          {name}
        </button>
      </div>
    );
  }
  return (
    <div className="bg-white p-3 shadow-sm sm:rounded-lg">
      <div className="flex items-center gap-2">
        <Avatar seed={seed} url={pictureUrl} />
        <button
          {...button}
          aria-label={name}
          className="min-w-0 flex-1 rounded-full bg-stone-100 px-4 py-2 text-left text-stone-500 hover:bg-stone-200"
        >
          What's on your mind{first ? `, ${first}` : ""}?
        </button>
      </div>
      {(showPhoto || decor) && (
        <div className="mt-3 flex border-t border-stone-200 pt-2 text-sm font-semibold text-stone-600 [&>button]:flex [&>button]:flex-1 [&>button]:items-center [&>button]:justify-center [&>button]:gap-2 [&>button]:rounded-lg [&>button]:py-2 [&>button:hover]:bg-stone-100">
          {decor && (
            <Decor id="live-video">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="#f0445c">
                <path d="M3 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v2.500l5-3v11l-5-3V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
              Live video
            </Decor>
          )}
          {showPhoto && (
            // The window that opens is where a photo is added.
            <button {...button} aria-label="Add a photo">
              <span className="text-repost">
                <PhotoIcon className="h-6 w-6" />
              </span>
              Photo
            </button>
          )}
          {decor && (
            <Decor id="feeling">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill="none"
                stroke="#f5a623"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="9" />
                <path
                  d="M8 14.500a4.5 4.5 0 0 0 8 0M9 9.500h.01M15 9.500h.01"
                  strokeLinecap="round"
                />
              </svg>
              Feeling
            </Decor>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The box under every post, already open with the viewer's picture beside it. Enter sends, and
 * shift and enter starts a new line.
 */
export function CommentBox({
  seed,
  pictureUrl,
  value = "",
  onChange,
  onSubmit,
  sending = false,
  inputRef,
  maxLength,
}: {
  /** The most they can write, where a study sets a limit. */
  maxLength?: number;
  seed: string;
  pictureUrl: string | null;
  value?: string;
  /** Leave this out to show a box that can't be used, as in a preview. */
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  sending?: boolean;
  inputRef?: Ref<HTMLTextAreaElement>;
}) {
  const canSend = Boolean(onChange) && !sending && value.trim().length > 0;

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (canSend) {
      onSubmit?.();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // While composing, as with a Japanese or Chinese keyboard, enter picks a word.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      send(event);
    }
  };

  return (
    <form onSubmit={send} className="flex items-start gap-2">
      <Avatar seed={seed} url={pictureUrl} size="h-8 w-8" />
      <div className="flex min-w-0 flex-1 items-end rounded-2xl bg-stone-100 pr-1">
        <textarea
          ref={inputRef}
          aria-label="Write a comment"
          rows={1}
          {...(maxLength ? { maxLength } : {})}
          disabled={!onChange}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Write a comment..."
          className="max-h-32 min-w-0 flex-1 resize-none bg-transparent py-1.5 pl-3 text-base outline-none [field-sizing:content]"
        />
        <button
          type="submit"
          aria-label="Send comment"
          disabled={!canSend}
          className="p-1.5 text-stone-700 disabled:opacity-30"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
            <path d="M3 20.5 21 12 3 3.5V10l11 2-11 2z" />
          </svg>
        </button>
      </div>
    </form>
  );
}

/** The card beside the feed, with the viewer's picture and details. */
export function ProfileCard({
  username,
  name,
  bio,
  location,
  pictureUrl,
  karma,
  renderName,
  footer,
  compact = false,
}: {
  username: string;
  name: string;
  bio: string;
  location: string;
  pictureUrl: string | null;
  /** Their points, on a platform with karma. */
  karma?: number | undefined;
  /** How to link to their page. Without it, their name is plain text. */
  renderName?: (className: string, name: string) => ReactNode;
  /** Shown along the bottom of the card, such as a way to edit it. */
  footer?: ReactNode;
  /** A small picture beside the name, rather than a large one across the top. */
  compact?: boolean;
}) {
  const nameClass = "block truncate font-semibold";
  if (compact) {
    return (
      <section
        aria-label="Your profile"
        className="overflow-hidden rounded-2xl border border-stone-200 bg-white"
      >
        <div className="flex items-center gap-3 p-3">
          <Avatar seed={username} url={pictureUrl} size="h-10 w-10" />
          <div className="min-w-0">
            {renderName ? renderName(nameClass, name) : <p className={nameClass}>{name}</p>}
            <p className="truncate text-xs text-stone-500">
              @{username}
              <KarmaBadge author={{ karma }} />
            </p>
          </div>
        </div>
        {footer}
      </section>
    );
  }
  return (
    <section aria-label="Your profile" className="overflow-hidden bg-white shadow-sm sm:rounded-lg">
      <Avatar seed={username} url={pictureUrl} size="aspect-square w-full" shape="" />
      <div className="space-y-1 p-3">
        {renderName ? renderName(nameClass, name) : <p className={nameClass}>{name}</p>}
        <p className="truncate text-sm text-stone-500">@{username}</p>
        <KarmaBadge author={{ karma }} />
        {bio && <p className="pt-1 text-sm break-words whitespace-pre-wrap">{bio}</p>}
        {location && <p className="pt-1 text-sm text-stone-500">{location}</p>}
      </div>
      {footer}
    </section>
  );
}
