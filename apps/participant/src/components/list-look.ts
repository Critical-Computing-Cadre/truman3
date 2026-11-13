import type { LayoutKey } from "@truman3/core";
import { usePlatform } from "@truman3/ui";

/**
 * How a page that's a list looks on each kind of site: Messages, one conversation, Notifications.
 * A community feed and a forum put it on a card. A photo app and a microblog lay it straight on
 * the page, as they do their posts. See ADR 76.
 */
const LOOKS: Record<LayoutKey, { frame: string; heading: string; unread: string }> = {
  classic: {
    frame: "bg-white shadow-sm sm:rounded-lg",
    heading: "p-4 text-xl font-semibold",
    unread: "bg-accent-soft",
  },
  forum: {
    frame: "border-y border-stone-200 bg-white sm:rounded-2xl sm:border",
    heading: "p-4 text-lg font-bold",
    unread: "bg-accent-soft",
  },
  photo: {
    frame: "bg-white",
    heading: "px-4 pt-5 pb-3 text-2xl font-bold",
    // A photo app marks what's new with bolder words and a dot, and no band of color.
    unread: "",
  },
  "short-posts": {
    frame: "min-h-[70vh] border-stone-200 bg-white sm:border-x",
    heading: "border-b border-stone-200 p-4 text-xl font-extrabold",
    unread: "bg-accent-soft",
  },
};

export function useListLook() {
  return LOOKS[usePlatform().layout];
}
