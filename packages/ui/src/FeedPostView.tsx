import type { FeedAuthor, FeedComment, FeedPost } from "@truman3/core";
import type { ReactNode, Ref } from "react";
import { Avatar } from "./Avatar.tsx";
import { shortTime } from "./time.ts";

/** What a viewer can do. Leave these out to show a post that looks real but can't be acted on. */
export interface PostActions {
  onLike: (contentId: string, active: boolean) => void;
  onFlag: (contentId: string, active: boolean) => void;
  onReply: () => void;
}

export interface FeedPostViewProps {
  post: FeedPost;
  actions?: PostActions;
  rootRef?: Ref<HTMLElement>;
  /** How to link to an author's page. Without it, their name is plain text. */
  renderAuthor?: (author: FeedAuthor, className: string, children: ReactNode) => ReactNode;
  /** Shown under the comments, such as a box for writing one. */
  belowComments?: ReactNode;
  /** A note about a post or comment. The admin app uses it to label condition targeting. */
  renderNote?: (contentId: string) => ReactNode;
}

function Comment({
  comment,
  actions,
  renderAuthor,
  renderNote,
}: { comment: FeedComment } & Pick<FeedPostViewProps, "actions" | "renderAuthor" | "renderNote">) {
  const author = (className: string, children: ReactNode) =>
    renderAuthor ? (
      renderAuthor(comment.author, className, children)
    ) : (
      <span className={className}>{children}</span>
    );

  if (comment.flagged) {
    return (
      <li className="flex items-center justify-between rounded bg-stone-800 px-3 py-2 text-sm text-white">
        <span>You flagged this comment.</span>
        <button
          type="button"
          className="underline"
          disabled={!actions}
          onClick={() => actions?.onFlag(comment.id, false)}
        >
          Unflag
        </button>
      </li>
    );
  }

  return (
    <li className="flex gap-2">
      {author(
        "shrink-0",
        <Avatar name={comment.author.name} url={comment.author.pictureUrl} size="h-8 w-8" />,
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm break-words whitespace-pre-wrap">
          {author("mr-1 font-semibold", comment.author.name)}
          {comment.body}
        </p>
        <p className="mt-0.5 flex gap-3 text-xs text-stone-500">
          <span>{shortTime(comment.at)}</span>
          <button
            type="button"
            disabled={!actions}
            className={comment.liked ? "font-semibold text-rose-600" : ""}
            onClick={() => actions?.onLike(comment.id, !comment.liked)}
          >
            {comment.liked ? "Unlike" : "Like"}
            {comment.likes > 0 ? ` (${comment.likes})` : ""}
          </button>
          {!comment.author.isViewer && (
            <button
              type="button"
              disabled={!actions}
              onClick={() => actions?.onFlag(comment.id, true)}
            >
              Flag
            </button>
          )}
        </p>
        {renderNote?.(comment.id)}
      </div>
    </li>
  );
}

/**
 * A post as participants see it. Both apps draw this same component, so what a researcher sees
 * while building a study is what a participant will see.
 */
export function FeedPostView({
  post,
  actions,
  rootRef,
  renderAuthor,
  belowComments,
  renderNote,
}: FeedPostViewProps) {
  const headerAuthor = (
    <>
      <Avatar name={post.author.name} url={post.author.pictureUrl} />
      <span className="truncate font-semibold">{post.author.name}</span>
    </>
  );
  const headerClass = "flex min-w-0 flex-1 items-center gap-3";

  return (
    <article
      ref={rootRef}
      aria-label={`Post by ${post.author.name}`}
      className="overflow-hidden bg-white shadow-sm sm:rounded-lg"
    >
      <header className="flex items-center gap-3 p-3">
        {renderAuthor ? (
          renderAuthor(post.author, headerClass, headerAuthor)
        ) : (
          <span className={headerClass}>{headerAuthor}</span>
        )}
        <time className="text-sm text-stone-500" dateTime={post.at}>
          {shortTime(post.at)}
        </time>
      </header>

      <div className="relative">
        {post.flagged && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-stone-900/85 p-6 text-center text-white">
            <p className="text-xl font-semibold">You've flagged this!</p>
            <p>The admins will review this post further. We are sorry you had this experience.</p>
            <button
              type="button"
              className="rounded border border-white px-4 py-2"
              disabled={!actions}
              onClick={() => actions?.onFlag(post.id, false)}
            >
              Unflag
            </button>
          </div>
        )}
        {post.imageUrl && (
          <img src={post.imageUrl} alt="" loading="lazy" className="w-full bg-stone-200" />
        )}
        {post.body && <p className="p-3 break-words whitespace-pre-wrap">{post.body}</p>}
        {renderNote && <div className="px-3 pb-2 empty:hidden">{renderNote(post.id)}</div>}
      </div>

      <div className="grid grid-cols-3 border-t border-stone-200 text-sm text-stone-700">
        <button
          type="button"
          disabled={!actions}
          className="py-3"
          onClick={() => actions?.onReply()}
        >
          Reply
        </button>
        <button
          type="button"
          disabled={!actions || post.author.isViewer || post.flagged}
          className={`py-3 ${actions ? "disabled:opacity-40" : ""}`}
          onClick={() => actions?.onFlag(post.id, true)}
        >
          Flag
        </button>
        <button
          type="button"
          aria-pressed={post.liked}
          disabled={!actions}
          className={`py-3 ${post.liked ? "font-semibold text-rose-600" : ""}`}
          onClick={() => actions?.onLike(post.id, !post.liked)}
        >
          {post.liked ? "♥" : "♡"} Like {post.likes > 0 && <span>({post.likes})</span>}
        </button>
      </div>

      {(post.comments.length > 0 || belowComments) && (
        <div className="space-y-3 border-t border-stone-200 p-3">
          <ul className="space-y-3">
            {post.comments.map((comment) => (
              <Comment
                key={comment.id}
                comment={comment}
                {...(actions ? { actions } : {})}
                {...(renderAuthor ? { renderAuthor } : {})}
                {...(renderNote ? { renderNote } : {})}
              />
            ))}
          </ul>
          {belowComments}
        </div>
      )}
    </article>
  );
}
