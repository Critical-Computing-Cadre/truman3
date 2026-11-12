import { FEATURE_KEYS, type FeatureSet } from "./catalog.ts";

/**
 * How posts and the page around them are arranged. A layout's look can't change once a study has
 * launched with it, so changing one means adding a new name, such as `classic-2` (ADR 18).
 */
export const LAYOUT_KEYS = ["classic", "forum", "short-posts", "photo"] as const;

export type LayoutKey = (typeof LAYOUT_KEYS)[number];

/**
 * The main color each layout comes with, which a study can change (ADR 76). The stylesheet that
 * draws them (packages/ui/src/skins.css) has the same four, and a test keeps the two in step.
 */
export const LAYOUT_ACCENTS: Record<LayoutKey, string> = {
  classic: "#1f5fcf",
  photo: "#d02a6a",
  "short-posts": "#0a7d85",
  forum: "#c9470a",
};

export interface TemplateDefinition {
  name: string;
  description: string;
  /**
   * How it looks and how people get around it, for someone choosing one. It says nothing about which
   * studies suit it, which is the researcher's call.
   */
  about: string;
  layout: LayoutKey;
  features: FeatureSet;
  /** What a study starting from this template begins with, which it can then change. */
  feed?: { ranker: "top" | "new"; commentOrder: "top" | "new" };
}

const allFeatures = Object.fromEntries(FEATURE_KEYS.map((key) => [key, true])) as FeatureSet;

/** Starting points. A study copies one, and can then change anything about it. */
export const TEMPLATES = {
  classic: {
    name: "Classic",
    description: "Truman's original platform: a feed of posts with comments open below each.",
    about:
      "Looks like a community feed, such as Facebook or LinkedIn. Posts sit on cards in one column, with the person's name and picture at the top, a count of likes, and a row of buttons across the bottom. Comments are open under each post, so people read and reply without leaving the feed. A bar across the top leads to notifications and their profile.",
    layout: "classic",
    features: {
      ...allFeatures,
      // Off unless a study turns it on, so studies that launched before it look the same.
      messages: false,
      push: false,
      threads: false,
      votes: false,
      galleries: false,
      spaces: false,
      postPages: false,
      titles: false,
      karma: false,
      links: false,
      pinning: false,
      locking: false,
      spoilers: false,
      adultTags: false,
      polls: false,
      flair: false,
      crossposting: false,
      removal: false,
      warnings: false,
      flagAnswers: false,
      reportAnswers: false,
      bans: false,
      autoRules: false,
      appeals: false,
      followingFeed: false,
      followCounts: false,
      reposts: false,
      quotes: false,
      badges: false,
      modLog: false,
      saving: false,
      hiding: false,
      sharing: false,
      contextNotes: false,
      hashtags: false,
      mentions: false,
      trending: false,
      whoToFollow: false,
      viewCounts: false,
      muting: false,
      stories: false,
      threadMuting: false,
      labels: false,
      profileGrid: false,
      exploreGrid: false,
      highlights: false,
      closeFriends: false,
      // Off, though Facebook has them, so a Classic study already running doesn't change.
      places: false,
      photoTags: false,
      ads: false,
    },
  },
  forum: {
    name: "Forum",
    description:
      "Communities with votes and points, where comments are threads on each post's own page.",
    about:
      "Looks like a discussion site, such as Reddit. Each post names its community, has a title, and has votes beside it. People open a post to read its comments, which nest as threads. Communities have their own pages, with a banner, rules, and moderators, and people choose which to join.",
    layout: "forum",
    features: {
      ...allFeatures,
      // Off unless a study turns it on, so studies that launched before it look the same.
      messages: false,
      push: false,
      likes: false,
      following: false,
      adultTags: false,
      // Kept for a study about appealing, and off otherwise, so a removal doesn't invite one.
      appeals: false,
      followingFeed: false,
      followCounts: false,
      reposts: false,
      quotes: false,
      badges: false,
      contextNotes: false,
      hashtags: false,
      mentions: false,
      trending: false,
      whoToFollow: false,
      viewCounts: false,
      muting: false,
      stories: false,
      threadMuting: false,
      labels: false,
      profileGrid: false,
      exploreGrid: false,
      highlights: false,
      closeFriends: false,
      places: false,
      photoTags: false,
    },
    feed: { ranker: "top", commentOrder: "top" },
  },
  shortPosts: {
    name: "Short posts",
    description:
      "Short posts from people you follow, with reposts and quotes, and replies on each post's own page.",
    about:
      "Looks like a microblog, such as Bluesky or X. A menu of icons down the left, a narrow column of short posts, and small icons with counts under each. People pass posts along or quote them, and a profile has a banner. Replies are on each post's own page.",
    layout: "short-posts",
    features: {
      ...allFeatures,
      // Off unless a study turns it on, so studies that launched before it look the same.
      messages: false,
      push: false,
      votes: false,
      titles: false,
      karma: false,
      spaces: false,
      flair: false,
      crossposting: false,
      adultTags: false,
      appeals: false,
      modLog: false,
      stories: false,
      profileGrid: false,
      exploreGrid: false,
      highlights: false,
      closeFriends: false,
      places: false,
      photoTags: false,
    },
    feed: { ranker: "new", commentOrder: "top" },
  },
  photo: {
    name: "Photo",
    description:
      "Square photos from people you follow, stories across the top, and a profile that's a grid of photos.",
    about:
      "Looks like a photo app in a browser, such as Instagram. Square photos fill the column, with icons under each, who liked it, and the caption. Stories run across the top and open full screen. A profile is a grid of photos, and Explore is a grid of photos from people someone doesn't follow.",
    layout: "photo",
    features: {
      ...allFeatures,
      // Off unless a study turns it on, so studies that launched before it look the same.
      messages: false,
      push: false,
      votes: false,
      titles: false,
      karma: false,
      spaces: false,
      flair: false,
      crossposting: false,
      adultTags: false,
      appeals: false,
      modLog: false,
      quotes: false,
      threadMuting: false,
      labels: false,
      followingFeed: false,
      links: false,
      polls: false,
      contextNotes: false,
      trending: false,
      viewCounts: false,
    },
    feed: { ranker: "new", commentOrder: "top" },
  },
} as const satisfies Record<string, TemplateDefinition>;

export type TemplateKey = keyof typeof TEMPLATES;

export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as [TemplateKey, ...TemplateKey[]];

export const DEFAULT_TEMPLATE: TemplateKey = "classic";
