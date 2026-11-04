import type { EventType } from "../events.ts";

export interface FeatureDefinition {
  /** What researchers see this called. */
  name: string;
  /** What it does for a participant, in a sentence. */
  description: string;
  /** Goes up when what it does changes, so a study's records say which one people used. */
  version: number;
  /** What it records when participants use it. */
  events: readonly EventType[];
}

/**
 * Every building block a platform can be made of. A template is a named set of these, and a study
 * or a condition can turn any of them on or off (ADR 18). See docs/guides/adding-a-feature.md.
 */
export const FEATURES = {
  posting: {
    name: "Writing posts",
    description: "Participants can write their own posts.",
    version: 1,
    events: ["content.created"],
  },
  comments: {
    name: "Comments",
    description: "Comments show under posts, and participants can write them.",
    version: 1,
    events: ["content.created", "comments.sort_changed"],
  },
  threads: {
    name: "Replies to replies",
    description:
      "Participants can reply to a comment, and replies sit under it. Off, the same comments show in time order.",
    version: 1,
    events: ["content.created"],
  },
  postPages: {
    name: "A page for each post",
    description:
      "Comments move from under each post to the post's own page, and opening it is recorded.",
    version: 1,
    events: ["content.opened"],
  },
  titles: {
    name: "Titles on posts",
    description: "Every post has a title, which participants have to write for theirs.",
    version: 1,
    events: [],
  },
  galleries: {
    name: "Several photos on a post",
    description: "Posts can show several photos, and participants can add several to theirs.",
    version: 1,
    events: ["content.created"],
  },
  likes: {
    name: "Likes",
    description: "Participants can like posts and comments.",
    version: 1,
    events: ["content.liked", "content.unliked"],
  },
  votes: {
    name: "Up and down votes",
    description: "Participants can vote posts and comments up or down, and see the score.",
    version: 1,
    events: ["content.voted"],
  },
  spaces: {
    name: "Spaces",
    description:
      "Posts can belong to communities, each with its own page and look. Off, every post shows in the one feed.",
    version: 2,
    events: ["space.joined", "space.left"],
  },
  karma: {
    name: "Karma",
    description:
      "People show a points total. The study sets everyone's, and a participant's grows with votes on what they post.",
    version: 1,
    events: [],
  },
  flagging: {
    name: "Flagging",
    description: "Participants can flag posts and comments.",
    version: 1,
    events: ["content.flagged", "content.unflagged"],
  },
  following: {
    name: "Following",
    description: "Participants can follow accounts from their profiles.",
    version: 1,
    events: ["actor.followed", "actor.unfollowed"],
  },
  blocking: {
    name: "Blocking",
    description: "Participants can block accounts from their profiles.",
    version: 1,
    events: ["actor.blocked", "actor.unblocked"],
  },
  reporting: {
    name: "Reporting",
    description: "Participants can report accounts from their profiles.",
    version: 1,
    events: ["actor.reported"],
  },
  notifications: {
    name: "Notifications",
    description: "Participants get a page of who has reacted to them.",
    version: 1,
    events: ["notifications.viewed"],
  },
} as const satisfies Record<string, FeatureDefinition>;

export type FeatureKey = keyof typeof FEATURES;

export const FEATURE_KEYS = Object.keys(FEATURES) as [FeatureKey, ...FeatureKey[]];

/** Which features are on. */
export type FeatureSet = Record<FeatureKey, boolean>;
