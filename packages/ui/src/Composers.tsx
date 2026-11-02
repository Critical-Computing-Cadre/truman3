import type { FormEvent, KeyboardEvent, ReactNode, Ref } from "react";
import { Avatar } from "./Avatar.tsx";

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
  return (
    <div className="flex items-center gap-2 bg-white p-3 shadow-sm sm:rounded-lg">
      <Avatar seed={seed} url={pictureUrl} />
      <button
        type="button"
        disabled={!onOpen}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center justify-between rounded-full bg-stone-100 px-4 py-2 text-left text-stone-500"
      >
        Create a post
        {showPhoto && <PhotoIcon />}
      </button>
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
}: {
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
  renderName,
}: {
  username: string;
  name: string;
  bio: string;
  location: string;
  pictureUrl: string | null;
  /** How to link to their page. Without it, their name is plain text. */
  renderName?: (className: string, name: string) => ReactNode;
}) {
  const nameClass = "block truncate font-semibold";
  return (
    <section aria-label="Your profile" className="overflow-hidden bg-white shadow-sm sm:rounded-lg">
      <Avatar seed={username} url={pictureUrl} size="aspect-square w-full" shape="" />
      <div className="space-y-1 p-3">
        {renderName ? renderName(nameClass, name) : <p className={nameClass}>{name}</p>}
        <p className="truncate text-sm text-stone-500">@{username}</p>
        {bio && <p className="pt-1 text-sm break-words whitespace-pre-wrap">{bio}</p>}
        {location && <p className="pt-1 text-sm text-stone-500">{location}</p>}
      </div>
    </section>
  );
}
