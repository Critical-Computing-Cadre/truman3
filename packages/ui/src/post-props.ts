import type { FeedAuthor, FeedComment, FeedPost } from "@truman3/core";
import type { ReactNode, Ref } from "react";

/** What a viewer can do. Leave these out to show a post that looks real but can't be acted on. */
export interface PostActions {
  onLike: (contentId: string, active: boolean) => void;
  onVote: (contentId: string, value: "up" | "down" | null) => void;
  onFlag: (contentId: string, active: boolean) => void;
  onReply: () => void;
  /** Reply to one comment, on a platform with threads. */
  onReplyTo?: (comment: FeedComment) => void;
  onSave?: (contentId: string, active: boolean) => void;
  onHide?: (contentId: string, active: boolean) => void;
  onMuteThread?: (contentId: string, active: boolean) => void;
  /** Copies a link to a post. Says whether that worked. */
  onShare?: (contentId: string) => Promise<boolean>;
  onOpenLink?: (contentId: string) => void;
  onReveal?: (contentId: string) => void;
  /** Records pressing Show on what a moderator's label covered, by what the label says. */
  onLabelShown?: (contentId: string, label: string) => void;
  /** Answers the yes-or-no question on a moderator's label. */
  onLabelAnswered?: (contentId: string, label: string, agree: boolean) => void;
  /** Opens the study's community rules. Only given when the study has them. */
  onOpenRules?: () => void;
  /** Chooses an option in a poll, by its place in the list. */
  onPollVote?: (contentId: string, option: number) => void;
  /** Appeals a moderator's removal or label of what they wrote. */
  onAppeal?: (contentId: string, text: string) => void;
  /** Rates the context note on a post. Null takes the rating back. */
  onRateNote?: (contentId: string, value: "helpful" | "not_helpful" | null) => void;
  /** Passes a post along, or takes that back. */
  onRepost?: (contentId: string, active: boolean) => void;
  /** Starts a post quoting this one. */
  onQuote?: (post: FeedPost) => void;
  /** Starts sharing this post into another community. */
  onCrosspost?: (post: FeedPost) => void;
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
  /** Replaces how the text is drawn. The admin app uses it to edit text where it appears. */
  renderBody?: (contentId: string, body: string) => ReactNode;
  /** How to link to a space's page. Without it, its name is plain text. */
  renderSpace?: (key: string, className: string, name: string) => ReactNode;
  /** Replaces how a post's title is drawn. The admin app uses it to edit one where it appears. */
  renderTitle?: (contentId: string, title: string) => ReactNode;
  /** How to link to a post's own page. Without it, nothing links there. */
  renderPostLink?: (postId: string, className: string, children: ReactNode) => ReactNode;
  /** Whether this is the post's own page, with all of it showing, rather than a place in a list. */
  detail?: boolean;
  /** Wraps where the image goes, even if there isn't one. The admin app uses it to drop images on. */
  wrapImage?: (image: ReactNode) => ReactNode;
}
