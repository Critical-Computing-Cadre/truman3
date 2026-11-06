import type { FeedComment } from "@truman3/core";
import type { ReactNode } from "react";
import { Avatar } from "../Avatar.tsx";
import { CommentReplyButton, ReplyButton } from "../features/comments.tsx";
import { ContextNoteBox } from "../features/context-notes.tsx";
import {
  CommentFlagButton,
  FlaggedComment,
  FlaggedPostCover,
  PostFlagButton,
} from "../features/flagging.tsx";
import { PostPhotos } from "../features/galleries.tsx";
import { CommentLikeButton, PostLikeButton } from "../features/likes.tsx";
import { useMoreMenu } from "../features/more-menu.tsx";
import { PhotoTags, PostPlace } from "../features/places-tags.tsx";
import {
  HideButton,
  PostBadges,
  SaveButton,
  ShareButton,
  TagCover,
} from "../features/post-extras.tsx";
import { CommentsLink } from "../features/post-pages.tsx";
import { PostText } from "../features/post-text.tsx";
import { RemovedNote } from "../features/removal.tsx";
import { QuotedPost, RepostButton, RepostedBy } from "../features/reposts.tsx";
import { ModeratorTag } from "../features/spaces.tsx";
import { CommentIcon } from "../icons.tsx";
import type { FeedPostViewProps } from "../post-props.ts";
import { shortTime } from "../time.ts";

function PhotoComment({
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
    <li id={`comment-${comment.id}`} className="text-sm">
      <p className="break-words whitespace-pre-wrap">
        {author("mr-1 font-semibold", comment.author.username)}
        <ModeratorTag author={comment.author} />{" "}
        {renderBody ? renderBody(comment.id, comment.body) : <PostText text={comment.body} />}
      </p>
      <RemovedNote item={comment} actions={actions} className="mt-1" />
      <p className="mt-0.5 flex gap-3 text-xs text-stone-500">
        <span>{shortTime(comment.at)}</span>
        <CommentLikeButton comment={comment} actions={actions} />
        <CommentReplyButton comment={comment} actions={actions} />
        <CommentFlagButton comment={comment} actions={actions} />
      </p>
      {renderNote?.(comment.id)}
    </li>
  );
}

/**
 * A photo post: who posted it, the photo square and edge to edge, icons under it, who liked it, then
 * the caption. It only arranges things, and what each piece does belongs to its feature.
 */
export function PhotoPost({
  post,
  actions,
  rootRef,
  renderAuthor,
  belowComments,
  renderNote,
  renderBody,
  renderPostLink,
  wrapImage,
  detail = false,
}: FeedPostViewProps) {
  const more = useMoreMenu(["flagging", "hiding"], "text-sm text-stone-600");
  const author = (className: string, children: ReactNode) =>
    renderAuthor ? (
      renderAuthor(post.author, className, children)
    ) : (
      <span className={className}>{children}</span>
    );
  const image =
    post.attachments.length > 0 ? (
      <div className="[&_img]:aspect-square [&_img]:w-full [&_img]:object-cover">
        <PostPhotos post={post} />
      </div>
    ) : null;
  const others = post.likes - 1;

  return (
    <article
      ref={rootRef}
      aria-label={`Post by ${post.author.name}`}
      className="relative border-b border-stone-200 bg-white pb-3 sm:rounded-lg sm:border"
    >
      <RepostedBy post={post} />
      <FlaggedPostCover post={post} {...(actions ? { actions } : {})} />
      <header className="flex items-center gap-2 px-3 py-2.5 text-sm">
        {author(
          "shrink-0",
          <span className="block rounded-full bg-gradient-to-tr from-amber-400 to-fuchsia-600 p-[2px]">
            <span className="block rounded-full bg-white p-[1px]">
              <Avatar seed={post.author.username} url={post.author.pictureUrl} size="h-8 w-8" />
            </span>
          </span>,
        )}
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="flex items-center gap-1">
            {author("font-semibold underline-offset-2 hover:underline", post.author.username)}
            <ModeratorTag author={post.author} />
            <time className="text-stone-500" dateTime={post.at}>
              · {shortTime(post.at)}
            </time>
          </span>
          <PostPlace post={post} className="truncate text-xs" />
        </span>
        <PostBadges post={post} className="ml-auto" />
        {more.collapsed ? more.toggle : null}
      </header>
      <RemovedNote item={post} actions={actions} className="mx-3 mb-2" />
      <TagCover post={post} actions={actions} editing={Boolean(renderBody)}>
        <div className="relative bg-stone-100 empty:hidden">
          {wrapImage ? wrapImage(image) : image}
          {image && <PhotoTags post={post} />}
        </div>
        <QuotedPost post={post} {...(renderPostLink ? { renderPostLink } : {})} />
      </TagCover>
      {more.open && (
        <div {...more.panelProps} className="flex gap-4 px-3 pt-2 text-sm">
          <PostFlagButton post={post} {...(actions ? { actions } : {})} />
          <HideButton post={post} actions={actions} />
        </div>
      )}
      <div className="flex items-center gap-4 px-3 pt-2.5">
        <PostLikeButton post={post} look="icon" {...(actions ? { actions } : {})} />
        {renderPostLink && !detail ? (
          renderPostLink(
            post.id,
            "flex items-center gap-1",
            <>
              <CommentIcon />
              <span className="sr-only">Comments</span>
              {post.commentCount > 0 && (
                <span className="text-sm font-semibold">{post.commentCount}</span>
              )}
            </>,
          )
        ) : detail ? (
          <ReplyButton actions={actions} post={post} />
        ) : null}
        <RepostButton post={post} actions={actions} look="icon" />
        <ShareButton post={post} actions={actions} />
        <span className="ml-auto">
          <SaveButton post={post} actions={actions} />
        </span>
        {!more.collapsed && (
          <span className="flex gap-3 text-sm text-stone-500">
            <PostFlagButton post={post} {...(actions ? { actions } : {})} />
            <HideButton post={post} actions={actions} />
          </span>
        )}
      </div>
      {post.likedBy && post.likes > 0 && (
        <p data-testid="liked-by" className="px-3 pt-2 text-sm">
          Liked by <span className="font-semibold">{post.likedBy}</span>
          {others > 0 && (
            <>
              {" "}
              and <span className="font-semibold">{others.toLocaleString("en-US")} others</span>
            </>
          )}
        </p>
      )}
      <div className="px-3 pt-1 text-sm">
        {renderBody
          ? renderBody(post.id, post.body)
          : post.body && (
              <p className={`break-words whitespace-pre-wrap ${detail ? "" : "line-clamp-2"}`}>
                {author("mr-1 font-semibold", post.author.username)}
                <PostText text={post.body} />
              </p>
            )}
      </div>
      <ContextNoteBox post={post} actions={actions} />
      {renderNote && <div className="px-3 pt-1 empty:hidden">{renderNote(post.id)}</div>}
      {!detail && post.commentCount > 0 && (
        <CommentsLink
          post={post}
          className="block px-3 pt-1 text-sm text-stone-500"
          {...(renderPostLink ? { renderPostLink } : {})}
        />
      )}
      {(post.comments.length > 0 || belowComments) && (
        <div className="space-y-3 px-3 pt-3">
          {post.comments.length > 0 && (
            <ul className="space-y-2">
              {post.comments.map((comment) => (
                <PhotoComment
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
          {belowComments}
        </div>
      )}
    </article>
  );
}
