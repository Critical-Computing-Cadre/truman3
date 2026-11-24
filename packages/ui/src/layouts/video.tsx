import type { FeedPost } from "@truman3/core";
import { type ReactNode, useState } from "react";
import { Avatar } from "../Avatar.tsx";
import { ReplyButton } from "../features/comments.tsx";
import { FlaggedPostCover, PostFlagButton } from "../features/flagging.tsx";
import { PostLikeButton } from "../features/likes.tsx";
import { useMoreMenu } from "../features/more-menu.tsx";
import { HideButton, SaveButton, ShareButton } from "../features/post-extras.tsx";
import { PostText } from "../features/post-text.tsx";
import { RemovedNote } from "../features/removal.tsx";
import { PostTitle } from "../features/titles.tsx";
import { PostVideo } from "../features/video.tsx";
import { useFeature } from "../platform.tsx";
import type { FeedPostViewProps } from "../post-props.ts";
import { shortTime } from "../time.ts";
import { ShortComment } from "./short-posts.tsx";

/** 1234 as "1.2K", as video sites write counts. */
export const countWords = (count: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(count);

/** A video's length as "4:05". */
export const lengthWords = (seconds: number) => {
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
};

/** What a post is called on a video site: its title, or the start of what it says. */
const nameOf = (post: FeedPost) => post.title ?? post.body.split("\n")[0]?.slice(0, 100) ?? "";

/** A post's picture, as a thumbnail: a video's poster, its photo, or its words on a card. */
function Thumbnail({ post }: { post: FeedPost }) {
  const [first] = post.attachments;
  const picture = first?.type === "video" ? first.posterUrl : first?.url;
  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-stone-200">
      {picture ? (
        <img src={picture} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent-fill to-stone-800 p-4 text-center text-sm font-semibold text-[#fff]">
          <span className="line-clamp-4">{post.body}</span>
        </div>
      )}
      {first?.type === "video" && first.seconds !== undefined && (
        <span className="absolute right-1.5 bottom-1.5 rounded bg-[#000]/80 px-1 text-xs font-semibold text-[#fff]">
          {lengthWords(first.seconds)}
        </span>
      )}
    </div>
  );
}

/** "1.2K views · 3h", or only the time where views aren't counted. */
function Seen({ post }: { post: FeedPost }) {
  return (
    <>
      {post.viewCount !== undefined &&
        `${countWords(post.viewCount)} ${post.viewCount === 1 ? "view" : "views"} · `}
      <time dateTime={post.at}>{shortTime(post.at)}</time>
    </>
  );
}

/**
 * A post on a video site (ADR 96). In a list it's a thumbnail with its title, channel, and views,
 * which opens its page. On its page it's the player, then the title, the channel with a way to
 * subscribe, the buttons, the description, and the comments.
 */
export function VideoPost(props: FeedPostViewProps) {
  return props.detail ? <WatchPage {...props} /> : <VideoCard {...props} />;
}

function VideoCard({
  post,
  actions,
  rootRef,
  renderAuthor,
  renderNote,
  renderBody,
  renderTitle,
  renderPostLink,
  wrapImage,
}: FeedPostViewProps) {
  const author = (className: string, children: ReactNode) =>
    renderAuthor ? (
      renderAuthor(post.author, className, children)
    ) : (
      <span className={className}>{children}</span>
    );
  const linked = (className: string, children: ReactNode) =>
    renderPostLink ? (
      renderPostLink(post.id, className, children)
    ) : (
      <div className={className}>{children}</div>
    );
  const thumbnail = <Thumbnail post={post} />;
  return (
    <article
      ref={rootRef}
      aria-label={nameOf(post) || `Video by ${post.author.name}`}
      className="min-w-0"
    >
      <FlaggedPostCover post={post} {...(actions ? { actions } : {})} />
      {wrapImage ? wrapImage(thumbnail) : linked("block", thumbnail)}
      <div className="mt-3 flex gap-3">
        {author(
          "shrink-0",
          <Avatar seed={post.author.username} url={post.author.pictureUrl} size="h-9 w-9" />,
        )}
        <div className="min-w-0 flex-1">
          {renderTitle ? (
            <PostTitle post={post} className="font-semibold" renderTitle={renderTitle} />
          ) : (
            linked("line-clamp-2 font-semibold leading-snug break-words", nameOf(post))
          )}
          <p className="mt-0.5 text-sm text-stone-600">
            {author("hover:text-stone-900", post.author.name)}
          </p>
          <p className="text-sm text-stone-600">
            <Seen post={post} />
          </p>
          {renderBody && <div className="mt-1 text-sm">{renderBody(post.id, post.body)}</div>}
          <RemovedNote item={post} actions={actions} className="mt-1" />
          {renderNote && <div className="pt-1 empty:hidden">{renderNote(post.id)}</div>}
        </div>
      </div>
    </article>
  );
}

const PILL =
  "flex items-center gap-1.5 rounded-full bg-stone-100 px-4 py-2 text-sm font-semibold hover:bg-stone-200 [&_svg]:h-5 [&_svg]:w-5";

function WatchPage({
  post,
  actions,
  rootRef,
  renderAuthor,
  belowComments,
  renderNote,
  renderBody,
  renderTitle,
  renderFollow,
  wrapImage,
}: FeedPostViewProps) {
  const [first] = post.attachments;
  const [more, setMore] = useState(false);
  const comments = useFeature("comments");
  const menu = useMoreMenu(["flagging", "hiding", "saving"], "text-sm text-stone-700", true);
  const author = (className: string, children: ReactNode) =>
    renderAuthor ? (
      renderAuthor(post.author, className, children)
    ) : (
      <span className={className}>{children}</span>
    );
  const media =
    first?.type === "video" ? (
      <PostVideo video={first} watch />
    ) : first ? (
      <img
        src={first.url}
        alt=""
        className="max-h-[75vh] w-full bg-[#000] object-contain sm:rounded-xl"
      />
    ) : null;
  const lessUsed = (
    <>
      <SaveButton post={post} actions={actions} className={PILL} />
      <PostFlagButton post={post} {...(actions ? { actions } : {})} />
      <HideButton post={post} actions={actions} />
    </>
  );
  return (
    <article
      ref={rootRef}
      aria-label={nameOf(post) || `Video by ${post.author.name}`}
      className="space-y-3"
    >
      <FlaggedPostCover post={post} {...(actions ? { actions } : {})} />
      {wrapImage ? wrapImage(media) : media}
      <div className="space-y-3 px-3 sm:px-0">
        <PostTitle
          post={post}
          className="text-xl font-bold leading-snug"
          {...(renderTitle ? { renderTitle } : {})}
        />
        <div className="flex flex-wrap items-center gap-3">
          {author(
            "shrink-0",
            <Avatar seed={post.author.username} url={post.author.pictureUrl} size="h-10 w-10" />,
          )}
          <div className="mr-2 min-w-0">
            <p className="font-semibold">{author("", post.author.name)}</p>
            <p className="text-xs text-stone-600">@{post.author.username}</p>
          </div>
          {renderFollow?.(post.author)}
          <div className="ml-auto flex flex-wrap items-center gap-2 [&_button]:whitespace-nowrap">
            <div className={PILL}>
              <PostLikeButton post={post} look="icon" {...(actions ? { actions } : {})} />
            </div>
            <ShareButton post={post} actions={actions} look="both" className={PILL} />
            {menu.collapsed ? menu.toggle : lessUsed}
          </div>
        </div>
        {menu.open && (
          <div {...menu.panelProps} className="flex flex-wrap gap-3">
            {lessUsed}
          </div>
        )}
        <RemovedNote item={post} actions={actions} />
        <section aria-label="Description" className="rounded-xl bg-stone-100 p-3 text-sm">
          <p className="font-semibold">
            <Seen post={post} />
          </p>
          {renderBody ? (
            renderBody(post.id, post.body)
          ) : (
            <div className={`break-words whitespace-pre-wrap ${more ? "" : "line-clamp-3"}`}>
              <PostText text={post.body} />
            </div>
          )}
          {!renderBody && post.body.length > 200 && (
            <button type="button" onClick={() => setMore(!more)} className="mt-1 font-semibold">
              {more ? "Show less" : "...more"}
            </button>
          )}
        </section>
        {renderNote && <div className="empty:hidden">{renderNote(post.id)}</div>}
        {comments && (
          <section aria-label="Comments" className="space-y-3 pt-2">
            <h2 className="flex items-center gap-4 text-lg font-bold">
              {post.commentCount} {post.commentCount === 1 ? "Comment" : "Comments"}
              <ReplyButton actions={actions} post={post} />
            </h2>
            {belowComments}
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
          </section>
        )}
      </div>
    </article>
  );
}
