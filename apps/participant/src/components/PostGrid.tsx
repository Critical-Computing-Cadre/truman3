import { Link } from "@tanstack/react-router";
import type { FeedPost } from "@truman3/core";

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
              aria-label={`Post by ${post.author.name}`}
              className="block aspect-square overflow-hidden bg-stone-200"
            >
              {post.attachments[0] ? (
                <img src={post.attachments[0].url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="block p-2 text-xs text-stone-700">{post.body}</span>
              )}
            </Link>
          </li>
        ))}
    </ul>
  );
}
