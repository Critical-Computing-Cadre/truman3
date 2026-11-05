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
    description:
      "Every post has a title, which participants have to write for theirs. A title can be a whole post.",
    version: 2,
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
  removal: {
    name: "Moderators removing things",
    description:
      "A moderator the study writes can remove a post or comment, with a reason, and a note takes its place. Telling a real person they broke a rule is a deception to raise with your IRB and in a debriefing.",
    version: 1,
    events: ["reaction.scheduled"],
  },
  flagAnswers: {
    name: "Moderators answering flags",
    description:
      "When someone flags a post or comment, a moderator the study writes can remove it, or answer with a message, such as that no rule was broken.",
    version: 1,
    events: ["reaction.scheduled"],
  },
  reportAnswers: {
    name: "Moderators answering reports",
    description:
      "When someone reports a person, a moderator the study writes can answer with a message, or ban that person.",
    version: 1,
    events: ["reaction.scheduled"],
  },
  bans: {
    name: "Moderators banning people",
    description:
      "A moderator the study writes can ban someone in the cast, who then stops appearing to post. Participants are never banned themselves.",
    version: 1,
    events: ["reaction.scheduled"],
  },
  autoRules: {
    name: "Automatic rules",
    description:
      'Words in what a participant writes can bring an "are you sure?" first, hold it for approval, remove it, or warn them. A word list can catch someone disclosing something serious, so test yours, and raise it with your IRB.',
    version: 1,
    events: ["moderation.rule_fired", "moderation.confirm_answered", "reaction.scheduled"],
  },
  appeals: {
    name: "Appeals",
    description:
      "A participant can appeal a moderator's removal of what they wrote, and a moderator the study writes answers. What they write is recorded.",
    version: 1,
    events: ["moderation.appealed", "reaction.scheduled"],
  },
  warnings: {
    name: "Moderators warning people",
    description:
      "A moderator the study writes can warn a participant about something they wrote, in a notice they have to acknowledge. Telling a real person they broke a rule is a deception to raise with your IRB and in a debriefing.",
    version: 1,
    events: ["reaction.scheduled", "moderation.warning_acknowledged"],
  },
  modLog: {
    name: "A public mod log",
    description:
      "A page lists what moderators have removed, by whom, and why, without what it said. Viewing it is recorded.",
    version: 1,
    events: ["page.viewed"],
  },
  karma: {
    name: "Karma",
    description:
      "People show a points total. The study sets everyone's, and a participant's grows with votes on what they post.",
    version: 1,
    events: [],
  },
  links: {
    name: "Link posts",
    description:
      "A post can link to another website, showing its domain. Opening a link is recorded.",
    version: 1,
    events: ["content.link_opened"],
  },
  pinning: {
    name: "Pinned posts",
    description:
      "Researchers can keep a post on top of the home feed, a community's page, or both.",
    version: 1,
    events: [],
  },
  locking: {
    name: "Locked posts",
    description: "Researchers can lock a post, so nobody can comment on it.",
    version: 1,
    events: [],
  },
  spoilers: {
    name: "Spoiler tags",
    description:
      "A post tagged as a spoiler stays covered until someone clicks it, which is recorded.",
    version: 1,
    events: ["content.revealed"],
  },
  adultTags: {
    name: "Adult content tags",
    description:
      "A post tagged as adult content stays covered until someone clicks it, which is recorded. There's no age check, so talk to your IRB before using this.",
    version: 1,
    events: ["content.revealed"],
  },
  polls: {
    name: "Polls",
    description:
      "A post can ask a question with options. Each person chooses once and can't change it, and the study sets the starting counts.",
    version: 1,
    events: ["content.poll_voted"],
  },
  flair: {
    name: "Flair",
    description:
      "A community can offer labels for posts and for people. Participants choose from its lists, and it can require one on posts.",
    version: 1,
    events: ["space.flair_chosen"],
  },
  crossposting: {
    name: "Crossposting",
    description:
      "A post can be shared into another community, as a new post that shows where it came from, with its own votes and comments.",
    version: 1,
    events: ["content.created"],
  },
  saving: {
    name: "Saving posts",
    description: "Participants can save posts to a list on their profile.",
    version: 1,
    events: ["content.saved", "content.unsaved"],
  },
  hiding: {
    name: "Hiding posts",
    description:
      "Participants can hide posts from their feeds, and bring them back from their profile.",
    version: 1,
    events: ["content.hidden", "content.unhidden"],
  },
  sharing: {
    name: "Sharing posts",
    description:
      "Participants can copy a link to a post. It only opens for someone in the same study who can already see that post.",
    version: 1,
    events: ["content.shared"],
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
