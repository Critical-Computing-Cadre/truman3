import { FEATURE_KEYS, type FeatureSet } from "./catalog.ts";

/**
 * How posts and the page around them are arranged. A layout's look can't change once a study has
 * launched with it, so changing one means adding a new name, such as `classic-2` (ADR 18).
 */
export const LAYOUT_KEYS = ["classic", "forum", "short-posts", "photo"] as const;

export type LayoutKey = (typeof LAYOUT_KEYS)[number];

export interface TemplateDefinition {
  name: string;
  description: string;
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
    layout: "classic",
    features: {
      ...allFeatures,
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
    layout: "forum",
    features: {
      ...allFeatures,
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
    layout: "short-posts",
    features: {
      ...allFeatures,
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
    layout: "photo",
    features: {
      ...allFeatures,
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
