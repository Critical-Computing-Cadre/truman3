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
  /** Wraps where the image goes, even if there isn't one. The admin app uses it to drop images on. */
  wrapImage?: (image: ReactNode) => ReactNode;
}
