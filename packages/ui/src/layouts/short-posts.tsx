import type { FeedComment } from "@truman3/core";
import type { ReactNode } from "react";
import { Avatar } from "../Avatar.tsx";
import { CommentReplyButton, ReplyButton, replyIndent } from "../features/comments.tsx";
import { ContextNoteBox } from "../features/context-notes.tsx";
import { CrosspostButton, CrosspostOriginal } from "../features/crossposting.tsx";
import {
  CommentFlagButton,
  FlaggedComment,
  FlaggedPostCover,
  PostFlagButton,
} from "../features/flagging.tsx";
import { AuthorFlair, PostFlair } from "../features/flair.tsx";
import { PostPhotos } from "../features/galleries.tsx";
import { KarmaBadge } from "../features/karma.tsx";
import { useLabels } from "../features/labels.tsx";
import { CommentLikeButton, PostLikeButton } from "../features/likes.tsx";
import { useMoreMenu } from "../features/more-menu.tsx";
import { WhoAndWhere } from "../features/places-tags.tsx";
import { PostPoll } from "../features/polls.tsx";
import {
  HideButton,
  MuteThreadButton,
  PostBadges,
  PostLink,
  SaveButton,
  ShareButton,
  TagCover,
} from "../features/post-extras.tsx";
import { CommentsLink } from "../features/post-pages.tsx";
import { PostText } from "../features/post-text.tsx";
import { RemovedNote } from "../features/removal.tsx";
import { QuoteButton, QuotedPost, RepostButton, RepostedBy } from "../features/reposts.tsx";
import { ModeratorTag, SpaceChip } from "../features/spaces.tsx";
import { PostTitle } from "../features/titles.tsx";
import { VoteButtons } from "../features/votes.tsx";
import type { FeedPostViewProps } from "../post-props.ts";
import { shortTime } from "../time.ts";

const ROW =
  "flex flex-wrap items-center gap-x-8 gap-y-1 pt-2 text-sm text-stone-500 [&_svg]:h-5 [&_svg]:w-5";

function ShortComment({
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
  const labels = useLabels(comment, actions, Boolean(renderBody));
  if (comment.flagged) {
    return <FlaggedComment comment={comment} actions={actions} />;
  }
  return (
    <li
      id={`comment-${comment.id}`}
      style={replyIndent(comment.depth)}
      className="flex gap-2 border-b border-stone-100 px-3 py-2"
    >
      {author(
        "shrink-0",
        <Avatar seed={comment.author.username} url={comment.author.pictureUrl} size="h-8 w-8" />,
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1 text-sm">
          {author("font-semibold", comment.author.name)}
          <ModeratorTag author={comment.author} />
          <span className="text-stone-500">
            @{comment.author.username} · {shortTime(comment.at)}
          </span>
        </p>
        {!labels.covered && (
          <div className="text-sm break-words whitespace-pre-wrap">
            {renderBody ? renderBody(comment.id, comment.body) : <PostText text={comment.body} />}
          </div>
        )}
        <RemovedNote item={comment} actions={actions} className="mt-1" />
        {labels.bar && <div className="mt-1">{labels.bar}</div>}
        <p className="mt-1 flex gap-4 text-xs text-stone-500">
          <CommentReplyButton comment={comment} actions={actions} />
          <CommentLikeButton comment={comment} actions={actions} />
          <VoteButtons item={comment} actions={actions} />
          <CommentFlagButton comment={comment} actions={actions} />
        </p>
        {renderNote?.(comment.id)}
      </div>
    </li>
  );
}

/**
 * A short post: a picture beside the name, then what it says, close to the next one. It only arranges
 * things, and what each piece does and whether it appears belongs to its feature.
 */
export function ShortPost({
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
  const labels = useLabels(post, actions, Boolean(renderBody));
  const more = useMoreMenu(
    ["flagging", "saving", "hiding", "threadMuting", "sharing", "crossposting", "quotes"],
    "text-sm text-stone-600",
    true,
  );
  const lessUsed = (
    <>
      <QuoteButton post={post} actions={actions} />
      <SaveButton post={post} actions={actions} />
      <HideButton post={post} actions={actions} />
      <MuteThreadButton post={post} actions={actions} />
      <ShareButton post={post} actions={actions} />
      <PostFlagButton post={post} {...(actions ? { actions } : {})} />
      <CrosspostButton post={post} actions={actions} />
    </>
  );
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
      className="relative border-b border-stone-200 bg-white transition-colors hover:bg-stone-50/60"
    >
      <RepostedBy post={post} />
      <FlaggedPostCover post={post} {...(actions ? { actions } : {})} />
      <div className="flex gap-3 p-3">
        {author(
          "shrink-0",
          <Avatar seed={post.author.username} url={post.author.pictureUrl} size="h-10 w-10" />,
        )}
        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center gap-x-1 text-sm">
            {author("font-semibold underline-offset-2 hover:underline", post.author.name)}
            <ModeratorTag author={post.author} />
            <AuthorFlair author={post.author} />
            <KarmaBadge author={post.author} />
            <span className="text-stone-500">@{post.author.username}</span>
            <time className="text-stone-500" dateTime={post.at}>
              · {shortTime(post.at)}
            </time>
            <SpaceChip post={post} renderSpace={renderSpace} />
            <PostBadges post={post} className="ml-auto" />
          </header>
          <WhoAndWhere post={post} className="text-sm text-stone-500" />
          <PostTitle
            post={post}
            className="pt-0.5 font-semibold"
            {...(renderTitle ? { renderTitle } : {})}
            {...(renderPostLink && !detail ? { renderPostLink } : {})}
          />
          <PostFlair post={post} className="pt-0.5" />
          <RemovedNote item={post} actions={actions} className="mt-1" />
          {labels.bar && <div className="mt-1">{labels.bar}</div>}
          {!labels.covered && (
            <TagCover post={post} actions={actions} editing={Boolean(renderBody)}>
              {renderBody ? (
                <div className="text-sm">{renderBody(post.id, post.body)}</div>
              ) : (
                post.body && (
                  <p className="break-words whitespace-pre-wrap">
                    <PostText text={post.body} />
                  </p>
                )
              )}
              <PostLink post={post} actions={actions} />
              <PostPoll post={post} actions={actions} />
              <ContextNoteBox post={post} actions={actions} />
              <QuotedPost post={post} {...(renderPostLink ? { renderPostLink } : {})} />
              <CrosspostOriginal
                post={post}
                {...(renderPostLink ? { renderPostLink } : {})}
                {...(renderSpace ? { renderSpace } : {})}
              />
              <div className="mt-2 overflow-hidden rounded-xl empty:hidden">
                {wrapImage ? wrapImage(image) : image}
              </div>
            </TagCover>
          )}
          {renderNote && <div className="pt-1 empty:hidden">{renderNote(post.id)}</div>}
          <div className={ROW}>
            {detail ? (
              <ReplyButton actions={actions} post={post} />
            ) : (
              <CommentsLink
                post={post}
                className=""
                look="icon"
                {...(renderPostLink ? { renderPostLink } : {})}
              />
            )}
            <RepostButton post={post} actions={actions} look="icon" />
            <PostLikeButton post={post} look="icon" {...(actions ? { actions } : {})} />
            <VoteButtons item={post} actions={actions} />
            {more.collapsed ? more.toggle : lessUsed}
          </div>
          {more.open && (
            <div {...more.panelProps} className={ROW}>
              {lessUsed}
            </div>
          )}
        </div>
      </div>
      {(post.comments.length > 0 || belowComments) && (
        <div className="border-t border-stone-200">
          {belowComments && <div className="p-3">{belowComments}</div>}
          {post.comments.length > 0 && (
            <ul>
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
          )}
        </div>
      )}
    </article>
  );
}
