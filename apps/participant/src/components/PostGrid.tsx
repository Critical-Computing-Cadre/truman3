import { Link } from "@tanstack/react-router";
import { type FeedPost, thumbnailOf } from "@truman3/core";

/** Posts as a grid of square photos, each opening the post's own page, as a photo platform shows them. */
export function PostGrid({ posts, label }: { posts: FeedPost[]; label: string }) {
  return (
    <ul aria-label={label} className="grid grid-cols-3 gap-1">
      {posts
        .filter((post) => !post.repostedBy)
        .map((post) => (
          <li key={post.id}>
            <Link
              to="/p/$postId"
              params={{ postId: post.id }}
              aria-label={`${post.attachments[0]?.type === "video" ? "Video" : "Post"} by ${post.author.name}`}
              className="block aspect-square overflow-hidden bg-stone-200"
            >
              {thumbnailOf(post.attachments[0]) ? (
                <span className="relative block h-full w-full">
                  <img
                    src={thumbnailOf(post.attachments[0])}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  {post.attachments[0]?.type === "video" && (
                    <span
                      aria-hidden="true"
                      className="absolute top-1.5 right-1.5 rounded bg-black/60 px-1.5 text-xs text-white"
                    >
                      ▶
                    </span>
                  )}
                </span>
              ) : post.attachments[0]?.type === "video" ? (
                <span className="flex h-full w-full items-center justify-center bg-black text-2xl text-white">
                  <span aria-hidden="true">▶</span>
                </span>
              ) : (
                <span className="block p-2 text-xs text-stone-700">{post.body}</span>
              )}
            </Link>
          </li>
        ))}
    </ul>
  );
}
