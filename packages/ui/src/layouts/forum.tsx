import type { FeedComment } from "@truman3/core";
import type { ReactNode } from "react";
import { Avatar } from "../Avatar.tsx";
import { CommentReplyButton, ReplyButton, replyIndent } from "../features/comments.tsx";
import {
  CommentFlagButton,
  FlaggedComment,
  FlaggedPostCover,
  PostFlagButton,
} from "../features/flagging.tsx";
import { PostPhotos } from "../features/galleries.tsx";
import { KarmaBadge } from "../features/karma.tsx";
import { CommentLikeButton, PostLikeButton } from "../features/likes.tsx";
import { CommentsLink } from "../features/post-pages.tsx";
import { ModeratorTag, SpaceChip } from "../features/spaces.tsx";
import { PostTitle } from "../features/titles.tsx";
import { VoteButtons } from "../features/votes.tsx";
import type { FeedPostViewProps } from "../post-props.ts";
import { shortTime } from "../time.ts";

/** A rounded button in the row under a post. It disappears if the feature inside it is off. */
const PILL =
  "flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1 text-sm font-medium text-stone-700 empty:hidden [&_button]:py-0.5";

function ForumComment({
  comment,
  actions,
  renderAuthor,
  renderNote,
  renderBody,
}: { comment: FeedComment } & Pick<
  FeedPostViewProps,
  "actions" | "renderAuthor" | "renderNote" | "renderBody"
>) {
  const author = (className: string, children: ReactNode) =>
    renderAuthor ? (
      renderAuthor(comment.author, className, children)
    ) : (
      <span className={className}>{children}</span>
    );

  if (comment.flagged) {
    return <FlaggedComment comment={comment} actions={actions} />;
  }

  return (
    <li
      style={replyIndent(comment.depth)}
      className={comment.depth > 0 ? "border-l-2 border-stone-200 pl-3" : ""}
    >
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-stone-500">
        {author(
          "shrink-0",
          <Avatar seed={comment.author.username} url={comment.author.pictureUrl} size="h-6 w-6" />,
        )}
        {author("font-semibold text-stone-800", comment.author.name)}
        <ModeratorTag author={comment.author} />
        <KarmaBadge author={comment.author} />
        <span>· {shortTime(comment.at)}</span>
      </p>
      <div className="mt-1 text-sm break-words whitespace-pre-wrap">
        {renderBody ? renderBody(comment.id, comment.body) : comment.body}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-3 text-xs font-medium text-stone-500">
        <VoteButtons item={comment} actions={actions} />
        <CommentLikeButton comment={comment} actions={actions} />
        <CommentReplyButton comment={comment} actions={actions} />
        <CommentFlagButton comment={comment} actions={actions} />
      </p>
      {renderNote?.(comment.id)}
    </li>
  );
}

/**
 * A forum's post, as a card: community and author, then a title, what it says, and a row of rounded
 * buttons. In a list its text is cut short. It only arranges things, and what each piece does and
 * whether it appears belongs to its feature.
 */
export function ForumPost({
  post,
  actions,
  rootRef,
  renderAuthor,
  belowComments,
  renderNote,
  renderBody,
  renderTitle,
  renderPostLink,
  renderSpace,
  wrapImage,
  detail = false,
}: FeedPostViewProps) {
  const image = post.attachments.length > 0 ? <PostPhotos post={post} /> : null;
  const author = (className: string, children: ReactNode) =>
    renderAuthor ? (
      renderAuthor(post.author, className, children)
    ) : (
      <span className={className}>{children}</span>
    );

  return (
    <article
      ref={rootRef}
      aria-label={post.title ?? `Post by ${post.author.name}`}
      className="overflow-hidden border-b border-stone-200 bg-white sm:rounded-2xl sm:border"
    >
      <div className="relative">
        <FlaggedPostCover post={post} {...(actions ? { actions } : {})} />
        <header className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-4 pt-3 text-xs text-stone-500">
          <SpaceChip post={post} renderSpace={renderSpace} />
          <span className="flex min-w-0 items-center gap-1">
            {author(
              "font-medium text-stone-600 underline-offset-2 hover:underline",
              post.author.name,
            )}
            <ModeratorTag author={post.author} />
            <KarmaBadge author={post.author} />
          </span>
          <time dateTime={post.at}>· {shortTime(post.at)}</time>
        </header>
        <PostTitle
          post={post}
          className="px-4 pt-1.5 text-lg leading-snug font-semibold"
          {...(renderTitle ? { renderTitle } : {})}
          {...(renderPostLink && !detail ? { renderPostLink } : {})}
        />
        {renderBody ? (
          <div className="px-4 pt-1.5 text-sm">{renderBody(post.id, post.body)}</div>
        ) : (
          post.body && (
            <p
              className={`px-4 pt-1.5 text-sm break-words whitespace-pre-wrap text-stone-700 ${detail ? "" : "line-clamp-4"}`}
            >
              {post.body}
            </p>
          )
        )}
        <div className="mx-4 mt-2.5 overflow-hidden rounded-xl empty:hidden">
          {wrapImage ? wrapImage(image) : image}
        </div>
        {renderNote && <div className="px-4 pt-1 empty:hidden">{renderNote(post.id)}</div>}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
          <div className={PILL}>
            <VoteButtons item={post} actions={actions} />
          </div>
          <div className={PILL}>
            <PostLikeButton post={post} {...(actions ? { actions } : {})} />
          </div>
          {detail ? (
            <div className={PILL}>
              <ReplyButton actions={actions} />
            </div>
          ) : (
            <CommentsLink
              post={post}
              className={PILL}
              {...(renderPostLink ? { renderPostLink } : {})}
            />
          )}
          <div className={PILL}>
            <PostFlagButton post={post} {...(actions ? { actions } : {})} />
          </div>
        </div>
      </div>

      {(post.comments.length > 0 || belowComments) && (
        <div className="space-y-4 border-t border-stone-200 p-4">
          {belowComments}
          {post.comments.length > 0 && (
            <ul className="space-y-4">
              {post.comments.map((comment) => (
                <ForumComment
                  key={comment.id}
                  comment={comment}
                  {...(actions ? { actions } : {})}
                  {...(renderAuthor ? { renderAuthor } : {})}
                  {...(renderNote ? { renderNote } : {})}
                  {...(renderBody ? { renderBody } : {})}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
