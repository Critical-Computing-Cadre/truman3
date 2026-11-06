import type { FeedPost } from "@truman3/core";
import { type ReactNode, useContext, useState } from "react";
import { UserIcon } from "../icons.tsx";
import { useFeature } from "../platform.tsx";
import { TextLinksContext } from "./post-text.tsx";

/** Where a post says it was, linked to every post there when a page can link it. */
export function PostPlace({ post, className = "" }: { post: FeedPost; className?: string }) {
  const on = useFeature("places");
  const links = useContext(TextLinksContext);
  if (!on || !post.place) {
    return null;
  }
  const text = <span data-testid="post-place">{post.place}</span>;
  return (
    <span className={className}>
      {links?.renderPlace ? links.renderPlace(post.place, text) : text}
    </span>
  );
}

/** A tagged person's name, linked to their profile when a page can link it. */
function Person({ username, name }: { username: string; name: string }): ReactNode {
  const links = useContext(TextLinksContext);
  return links ? links.renderMention(username, name) : name;
}

/**
 * Who's tagged in a photo: a person icon on the photo, which shows their names over it. Goes inside
 * something positioned, such as the photo's frame.
 */
export function PhotoTags({ post }: { post: FeedPost }) {
  const on = useFeature("photoTags");
  const [open, setOpen] = useState(false);
  if (!on || !post.tagged?.length || post.attachments.length === 0) {
    return null;
  }
  return (
    <>
      {open && (
        <ul
          data-testid="photo-tags"
          className="absolute inset-x-3 top-3 flex flex-wrap justify-center gap-2"
        >
          {post.tagged.map((person) => (
            <li
              key={person.username}
              className="rounded bg-black/75 px-2 py-1 text-sm font-semibold text-white"
            >
              <Person {...person} />
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        aria-pressed={open}
        aria-label={`Tagged: ${post.tagged.map(({ name }) => name).join(", ")}`}
        onClick={() => setOpen(!open)}
        className="absolute bottom-3 left-3 rounded-full bg-black/75 p-1.5 text-white"
      >
        <UserIcon className="h-4 w-4" />
      </button>
    </>
  );
}

/** Who's tagged, in words, as a post without a photo says it: "with Ann and Bob." */
export function TaggedLine({ post, className = "" }: { post: FeedPost; className?: string }) {
  const on = useFeature("photoTags");
  if (!on || !post.tagged?.length) {
    return null;
  }
  const people = post.tagged;
  return (
    <span data-testid="tagged-line" className={className}>
      with{" "}
      {people.map((person, index) => (
        <span key={person.username}>
          {index > 0 && (index === people.length - 1 ? " and " : ", ")}
          <span className="font-semibold">
            <Person {...person} />
          </span>
        </span>
      ))}
    </span>
  );
}

/** "with Ann and Bob · at Ithaca", for layouts that say it in words. Nothing when there's neither. */
export function WhoAndWhere({ post, className = "" }: { post: FeedPost; className?: string }) {
  const tagsOn = useFeature("photoTags");
  const placesOn = useFeature("places");
  const tagged = tagsOn && Boolean(post.tagged?.length);
  const placed = placesOn && Boolean(post.place);
  if (!tagged && !placed) {
    return null;
  }
  return (
    <p className={className}>
      {tagged && <TaggedLine post={post} />}
      {tagged && placed && " · "}
      {placed && (
        <>
          at <PostPlace post={post} className="font-semibold" />
        </>
      )}
    </p>
  );
}
