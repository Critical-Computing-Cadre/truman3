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
import { ModeratorTag, SpaceLine } from "../features/spaces.tsx";
import { PostTitle } from "../features/titles.tsx";
import { VoteButtons } from "../features/votes.tsx";
import { useFeature } from "../platform.tsx";
import type { FeedPostViewProps } from "../post-props.ts";
import { shortTime } from "../time.ts";

function Comment({
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
    <li id={`comment-${comment.id}`} className="flex gap-2" style={replyIndent(comment.depth)}>
      {author(
        "shrink-0",
        <Avatar seed={comment.author.username} url={comment.author.pictureUrl} size="h-8 w-8" />,
      )}
      <div className="min-w-0 flex-1">
        {labels.covered ? (
          <p className="text-sm">{author("font-semibold", comment.author.name)}</p>
        ) : renderBody ? (
          <div className="text-sm">
            {author("font-semibold", comment.author.name)}
            <ModeratorTag author={comment.author} />
            <AuthorFlair author={comment.author} />
            <KarmaBadge author={comment.author} />
            {renderBody(comment.id, comment.body)}
          </div>
        ) : (
          <p className="text-sm break-words whitespace-pre-wrap">
            {author("mr-1 font-semibold", comment.author.name)}
            <ModeratorTag author={comment.author} />
            <AuthorFlair author={comment.author} />
            <KarmaBadge author={comment.author} /> <PostText text={comment.body} />
          </p>
        )}
        <RemovedNote item={comment} actions={actions} className="mt-1" />
        {labels.bar && <div className="mt-1">{labels.bar}</div>}
        <p className="mt-0.5 flex gap-3 text-xs text-stone-500">
          <span>{shortTime(comment.at)}</span>
          <CommentLikeButton comment={comment} actions={actions} />
          <VoteButtons item={comment} actions={actions} />
          <CommentReplyButton comment={comment} actions={actions} />
          <CommentFlagButton comment={comment} actions={actions} />
        </p>
        {renderNote?.(comment.id)}
      </div>
    </li>
  );
}

/**
 * Truman's original post: author, then image, text, a row of buttons, and comments. It only
 * arranges things. What each piece does and whether it appears belongs to its feature.
 */
export function ClassicPost({
  post,
  actions,
  rootRef,
  renderAuthor,
  belowComments,
  renderNote,
  renderBody,
  wrapImage,
  renderSpace,
  renderTitle,
  renderPostLink,
  detail = false,
}: FeedPostViewProps) {
  const commentsOn = useFeature("comments");
  const likesOn = useFeature("likes");
  const flaggingOn = useFeature("flagging");
  const votesOn = useFeature("votes");
  const savingOn = useFeature("saving");
  const hidingOn = useFeature("hiding");
  const sharingOn = useFeature("sharing");
  const crosspostingOn = useFeature("crossposting");
  const repostsOn = useFeature("reposts");
  const quotesOn = useFeature("quotes");
  const labels = useLabels(post, actions, Boolean(renderBody));
  const more = useMoreMenu(["saving", "hiding", "threadMuting", "crossposting", "quotes"], "py-2");
  const lessUsed = (className: string) => (
    <>
      <SaveButton post={post} actions={actions} className={className} />
      <HideButton post={post} actions={actions} className={className} />
      <MuteThreadButton post={post} actions={actions} className={className} />
      <CrosspostButton post={post} actions={actions} className={className} />
      <QuoteButton post={post} actions={actions} className={className} />
    </>
  );

  const image = post.attachments.length > 0 ? <PostPhotos post={post} /> : null;

  const headerAuthor = (
    <>
      <Avatar seed={post.author.username} url={post.author.pictureUrl} />
      <span className="truncate font-semibold">{post.author.name}</span>
      <ModeratorTag author={post.author} />
      <AuthorFlair author={post.author} />
      <KarmaBadge author={post.author} />
    </>
  );
  const headerClass = "flex min-w-0 flex-1 items-center gap-3";

  return (
    <article
      ref={rootRef}
      aria-label={`Post by ${post.author.name}`}
      className="overflow-hidden border-y border-stone-200 bg-white sm:rounded-xl sm:border"
    >
      <RepostedBy post={post} />
      <SpaceLine post={post} renderSpace={renderSpace} />
      <header className="flex items-center gap-3 p-3">
        {renderAuthor ? (
          renderAuthor(post.author, headerClass, headerAuthor)
        ) : (
          <span className={headerClass}>{headerAuthor}</span>
        )}
        <PostBadges post={post} />
        <time className="text-sm text-stone-500" dateTime={post.at}>
          {shortTime(post.at)}
        </time>
      </header>
      <WhoAndWhere post={post} className="-mt-1 px-3 pb-2 text-sm text-stone-600" />

      <div className="relative">
        <FlaggedPostCover post={post} {...(actions ? { actions } : {})} />
        <PostTitle
          post={post}
          className="px-3 pb-2 text-lg font-semibold"
          {...(renderTitle ? { renderTitle } : {})}
          {...(renderPostLink && !detail ? { renderPostLink } : {})}
        />
        <PostFlair post={post} className="px-3 pb-2" />
        <RemovedNote item={post} actions={actions} className="mx-3 mb-2" />
        {labels.bar && <div className="mx-3 mb-2">{labels.bar}</div>}
        {!labels.covered && (
          <TagCover post={post} actions={actions} editing={Boolean(renderBody)}>
            {wrapImage ? wrapImage(image) : image}
            {renderBody ? (
              <div className="p-3">{renderBody(post.id, post.body)}</div>
            ) : (
              post.body && (
                <p className="p-3 break-words whitespace-pre-wrap">
                  <PostText text={post.body} />
                </p>
              )
            )}
            <PostLink post={post} actions={actions} />
            <PostPoll post={post} actions={actions} />
            <ContextNoteBox post={post} actions={actions} />
            <CrosspostOriginal
              post={post}
              {...(renderPostLink ? { renderPostLink } : {})}
              {...(renderSpace ? { renderSpace } : {})}
            />
            <QuotedPost post={post} {...(renderPostLink ? { renderPostLink } : {})} />
          </TagCover>
        )}
        {renderNote && <div className="px-3 pb-2 empty:hidden">{renderNote(post.id)}</div>}
      </div>

      {/* A count of reactions and comments above the buttons, as on a community feed. */}
      {(post.likes > 0 || post.commentCount > 0) && (likesOn || commentsOn) && (
        <div className="flex items-center justify-between px-3 pb-2 text-sm text-stone-500">
          <span>{likesOn && post.likes > 0 ? `♥ ${post.likes.toLocaleString("en-US")}` : ""}</span>
          {!detail && commentsOn && post.commentCount > 0 && (
            <CommentsLink post={post} {...(renderPostLink ? { renderPostLink } : {})} />
          )}
        </div>
      )}
      {(commentsOn ||
        likesOn ||
        flaggingOn ||
        votesOn ||
        savingOn ||
        hidingOn ||
        sharingOn ||
        crosspostingOn ||
        repostsOn ||
        quotesOn) && (
        <div className="mx-3 grid auto-cols-fr grid-flow-col border-t border-stone-200 text-sm font-medium text-stone-600">
          <PostLikeButton post={post} look="both" {...(actions ? { actions } : {})} />
          <ReplyButton actions={actions} post={post} />
          <VoteButtons item={post} actions={actions} className="py-2" />
          <RepostButton post={post} actions={actions} className="justify-center py-2" look="icon" />
          <ShareButton post={post} actions={actions} look="both" className="justify-center py-2" />
          <PostFlagButton post={post} {...(actions ? { actions } : {})} />
          {more.collapsed ? more.toggle : lessUsed("py-2")}
        </div>
      )}

      {more.open && (
        <div
          {...more.panelProps}
          className="flex flex-wrap items-center gap-4 border-t border-stone-200 px-3 text-sm text-stone-700"
        >
          {lessUsed("py-3")}
        </div>
      )}

      {commentsOn && (post.comments.length > 0 || belowComments) && (
        <div className="space-y-3 border-t border-stone-200 p-3">
          {post.comments.length > 0 && (
            <ul className="space-y-3">
              {post.comments.map((comment) => (
                <Comment
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
