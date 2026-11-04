import { type FeedAuthor, type FeedPost, textOnAccent } from "@truman3/core";
import { useFeature } from "../platform.tsx";

function FlairChip({ flair }: { flair: { text: string; color?: string | undefined } }) {
  return (
    <span
      style={
        flair.color ? { backgroundColor: flair.color, color: textOnAccent(flair.color) } : undefined
      }
      className={`inline-block rounded-full px-2 py-0.5 text-[0.7rem] font-medium align-middle ${flair.color ? "" : "bg-stone-200 text-stone-700"}`}
    >
      {flair.text}
    </span>
  );
}

/** A post's label, from its community's list. */
export function PostFlair({ post, className = "" }: { post: FeedPost; className?: string }) {
  const on = useFeature("flair");
  if (!on || !post.flair) {
    return null;
  }
  return (
    <div className={className} data-testid="post-flair">
      <FlairChip flair={post.flair} />
    </div>
  );
}

/** What someone shows beside their name in the community this is in. */
export function AuthorFlair({ author }: { author: FeedAuthor }) {
  const on = useFeature("flair");
  if (!on || !author.flair) {
    return null;
  }
  return (
    <span className="ml-1" data-testid="author-flair">
      <FlairChip flair={author.flair} />
    </span>
  );
}
