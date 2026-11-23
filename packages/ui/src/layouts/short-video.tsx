import type { ReactNode } from "react";
import { useState } from "react";
import { Avatar } from "../Avatar.tsx";
import { FlaggedPostCover, PostFlagButton } from "../features/flagging.tsx";
import { PostLikeButton } from "../features/likes.tsx";
import { HideButton, SaveButton, ShareButton } from "../features/post-extras.tsx";
import { PostText } from "../features/post-text.tsx";
import { RemovedNote } from "../features/removal.tsx";
import { PostVideo } from "../features/video.tsx";
import { CommentIcon } from "../icons.tsx";
import { useFeature } from "../platform.tsx";
import type { FeedPostViewProps } from "../post-props.ts";
import { ShortComment } from "./short-posts.tsx";

/** A button down the right side: an icon over its count, white over the video. */
const RAIL =
  "flex flex-col items-center gap-0.5 text-xs font-semibold text-[#fff] drop-shadow [&_svg]:h-8 [&_svg]:w-8 [&>span]:text-xs";

/**
 * A post on a short-video site (ADR 95): it fills the screen, its video plays by itself, and the
 * author, like, comments, save, and share run down the right side. Comments slide up over it. A
 * post without a video shows its picture, or its words on a card, so other content still shows.
 */
export function ShortVideoPost({
  post,
  actions,
  rootRef,
  renderAuthor,
  belowComments,
  renderNote,
  renderBody,
  wrapImage,
}: FeedPostViewProps) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const comments = useFeature("comments");
  const [first] = post.attachments;
  const author = (className: string, children: ReactNode) =>
    renderAuthor ? (
      renderAuthor(post.author, className, children)
    ) : (
      <span className={className}>{children}</span>
    );

  const media =
    first?.type === "video" ? (
      <PostVideo video={first} autoplay />
    ) : first ? (
      <img src={first.url} alt="" className="h-full w-full object-contain" />
    ) : (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-accent-fill to-stone-900 p-8 text-center text-2xl font-semibold text-[#fff]">
        <p className="break-words whitespace-pre-wrap">
          <PostText text={post.body} />
        </p>
      </div>
    );

  return (
    <article
      ref={rootRef}
      aria-label={`Post by ${post.author.name}`}
      className="relative mx-auto aspect-[9/16] max-h-[85dvh] w-full max-w-[28rem] shrink-0 snap-start snap-always overflow-hidden bg-[#000] text-[#fff]"
    >
      <FlaggedPostCover post={post} {...(actions ? { actions } : {})} />
      <div className="absolute inset-0">{wrapImage ? wrapImage(media) : media}</div>

      {/* What it says, over the bottom of the video, under the buttons' column. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#000]/70 to-transparent px-4 pt-16 pb-4 pr-20">
        <p className="pointer-events-auto font-semibold drop-shadow">
          {author("", `@${post.author.username}`)}
        </p>
        <RemovedNote item={post} actions={actions} className="pointer-events-auto mt-1" />
        {(first || renderBody) && (
          <div className="pointer-events-auto mt-1 text-sm break-words whitespace-pre-wrap drop-shadow">
            {renderBody ? renderBody(post.id, post.body) : <PostText text={post.body} />}
          </div>
        )}
        {renderNote && (
          <div className="pointer-events-auto pt-1 empty:hidden">{renderNote(post.id)}</div>
        )}
      </div>

      {/* Down the right side. */}
      <div className="absolute right-2 bottom-24 flex flex-col items-center gap-5">
        {author(
          "block rounded-full ring-2 ring-[#fff]",
          <Avatar seed={post.author.username} url={post.author.pictureUrl} size="h-12 w-12" />,
        )}
        <div className={RAIL}>
          <PostLikeButton post={post} look="icon" {...(actions ? { actions } : {})} />
        </div>
        {comments && (
          <button
            type="button"
            aria-expanded={commentsOpen}
            onClick={() => {
              setCommentsOpen(true);
              actions?.onReply();
            }}
            className={RAIL}
          >
            <CommentIcon />
            <span>
              {post.commentCount > 0 ? post.commentCount : ""}
              <span className="sr-only"> Comments</span>
            </span>
          </button>
        )}
        <div className={RAIL}>
          <SaveButton post={post} actions={actions} look="icon" />
        </div>
        <div className={`${RAIL} [&_button]:flex-col [&_button]:gap-0.5`}>
          <ShareButton post={post} actions={actions} look="icon" />
        </div>
        <div className={`${RAIL} gap-3 text-[0.7rem]`}>
          <PostFlagButton post={post} {...(actions ? { actions } : {})} />
          <HideButton post={post} actions={actions} />
        </div>
      </div>

      {commentsOpen && (
        <section
          aria-label="Comments"
          className="absolute inset-x-0 bottom-0 z-10 flex max-h-[70%] flex-col rounded-t-2xl bg-white text-stone-900"
        >
          <header className="flex items-center border-b border-stone-200 px-4 py-3">
            <h2 className="flex-1 text-center text-sm font-semibold">
              {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
            </h2>
            <button
              type="button"
              aria-label="Close comments"
              onClick={() => setCommentsOpen(false)}
              className="text-xl leading-none text-stone-500"
            >
              ×
            </button>
          </header>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {post.comments.map((comment) => (
              <ShortComment
                key={comment.id}
                comment={comment}
                {...(actions ? { actions } : {})}
                {...(renderAuthor ? { renderAuthor } : {})}
                {...(renderNote ? { renderNote } : {})}
                {...(renderBody ? { renderBody } : {})}
              />
            ))}
          </ul>
          {belowComments && <div className="border-t border-stone-200 p-3">{belowComments}</div>}
        </section>
      )}
    </article>
  );
}
