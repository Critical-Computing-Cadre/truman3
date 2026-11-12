import type { LayoutKey } from "./templates.ts";

/**
 * A real page something for show can open, where a study has one. "Saved" opens the participant's
 * own page, which is where their saved posts are.
 */
export type DecorTarget =
  | "spaces"
  | "explore"
  | "saved"
  | "account"
  | "rules"
  | "terms"
  | "privacy";

export interface DecorItem {
  key: string;
  /** What it's called on the page. */
  label: string;
  /** Where on the page it is, for a researcher choosing which to keep. */
  where: "Top bar" | "Menu" | "Post box" | "Beside the feed" | "Small print" | "Corner";
  /** The real page it opens where the study has one. Without one, pressing it says it isn't available. */
  opens?: DecorTarget;
}

/** When each target is real, in words, for the builder. */
export const DECOR_TARGETS: Record<DecorTarget, string> = {
  spaces: "Opens Communities when spaces are on",
  explore: "Opens Explore when the study has trending, who to follow, or an Explore grid",
  saved: "Opens their own page, where saved posts are, when saving is on",
  account: "Opens the page where they edit their profile",
  rules: "Opens the rules page when the study has one",
  terms: "Opens the terms page when the study has one",
  privacy: "Opens the privacy page when the study has one",
};

const print = (labels: readonly (string | [string, DecorTarget])[]): DecorItem[] =>
  labels.map((entry) => {
    const [label, opens] = typeof entry === "string" ? [entry, undefined] : entry;
    return {
      key: `print-${label.toLowerCase().replaceAll(" ", "-")}`,
      label,
      where: "Small print",
      ...(opens ? { opens } : {}),
    };
  });

/**
 * Everything each layout draws that's only for show (the `decor` feature, ADR 77): what a real site
 * of that kind has around its posts. A study can hide any of these, and add its own. A layout draws
 * one with `<Decor id>`, and a test checks that every one it draws is listed here.
 */
export const DECOR_ITEMS: Record<LayoutKey, readonly DecorItem[]> = {
  classic: [
    { key: "search", label: "Search box", where: "Top bar" },
    { key: "video", label: "Video", where: "Top bar" },
    { key: "marketplace-tab", label: "Marketplace", where: "Top bar" },
    { key: "menu", label: "Menu", where: "Top bar" },
    { key: "friends", label: "Friends", where: "Menu", opens: "explore" },
    { key: "groups", label: "Groups", where: "Menu", opens: "spaces" },
    { key: "saved", label: "Saved", where: "Menu", opens: "saved" },
    { key: "memories", label: "Memories", where: "Menu" },
    { key: "events", label: "Events", where: "Menu" },
    { key: "marketplace", label: "Marketplace", where: "Menu" },
    { key: "see-more", label: "See more", where: "Menu" },
    { key: "live-video", label: "Live video", where: "Post box" },
    { key: "feeling", label: "Feeling", where: "Post box" },
    { key: "contacts", label: "Contacts", where: "Beside the feed" },
    { key: "corner", label: "Messaging", where: "Corner" },
    ...print([
      ["Privacy", "privacy"],
      ["Terms", "terms"],
      "Advertising",
      "Ad Choices",
      "Cookies",
      "More",
    ]),
  ],
  photo: [
    { key: "reels", label: "Reels", where: "Menu" },
    { key: "more", label: "More", where: "Menu", opens: "account" },
    { key: "also", label: "Also from us", where: "Menu" },
    { key: "corner", label: "Messages", where: "Corner" },
    ...print([
      "About",
      "Help",
      "Press",
      "API",
      "Jobs",
      ["Privacy", "privacy"],
      ["Terms", "terms"],
      "Locations",
      "Language",
    ]),
  ],
  "short-posts": [
    { key: "search", label: "Search box", where: "Beside the feed" },
    { key: "lists", label: "Lists", where: "Menu" },
    { key: "bookmarks", label: "Bookmarks", where: "Menu", opens: "saved" },
    { key: "settings", label: "Settings", where: "Menu", opens: "account" },
    { key: "corner", label: "Chat", where: "Corner" },
    ...print([
      "About",
      "Help",
      ["Terms", "terms"],
      ["Privacy", "privacy"],
      "Accessibility",
      "Ads info",
      "Blog",
      "Developers",
    ]),
  ],
  forum: [
    { key: "search", label: "Search box", where: "Top bar" },
    { key: "popular", label: "Popular", where: "Menu", opens: "explore" },
    { key: "answers", label: "Answers", where: "Menu" },
    { key: "all", label: "All", where: "Menu" },
    { key: "about", label: "About", where: "Menu" },
    { key: "help", label: "Help", where: "Menu" },
    { key: "blog", label: "Blog", where: "Menu" },
    { key: "careers", label: "Careers", where: "Menu" },
    { key: "corner", label: "Chat", where: "Corner" },
    ...print([
      ["Rules", "rules"],
      ["Privacy Policy", "privacy"],
      ["User Agreement", "terms"],
      "Accessibility",
    ]),
  ],
};

/** The most a study can add of its own, which is what fits in a menu without crowding it. */
export const MAX_DECOR_ADDED = 8;
export const MAX_DECOR_LABEL = 30;

/** The key a study's own for-show item is recorded under. */
export function addedDecorKey(label: string) {
  return `added-${label.trim().toLowerCase().replaceAll(/\s+/g, "-")}`;
}
