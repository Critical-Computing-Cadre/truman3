import type { FeedPost } from "@truman3/core";
import { useFeature } from "../platform.tsx";

/**
 * A post's photos. Without galleries, only the first shows, so the same post can run in both
 * conditions of a study. Several photos sit in a row people swipe or scroll through.
 */
export function PostPhotos({ post }: { post: FeedPost }) {
  const galleries = useFeature("galleries");
  const shown = galleries ? post.attachments : post.attachments.slice(0, 1);

  if (shown.length <= 1) {
    return shown[0] ? (
      <img src={shown[0].url} alt="" loading="lazy" className="w-full bg-stone-200" />
    ) : null;
  }
  return (
    <section
      aria-label={`${shown.length} photos`}
      className="flex snap-x snap-mandatory overflow-x-auto bg-stone-200"
    >
      {shown.map((attachment, index) => (
        <div key={attachment.url} className="relative w-full shrink-0 snap-center">
          <img src={attachment.url} alt="" loading="lazy" className="w-full" />
          <span className="absolute top-2 right-2 rounded bg-stone-900/70 px-2 py-0.5 text-xs text-white">
            {index + 1} of {shown.length}
          </span>
        </div>
      ))}
    </section>
  );
}
