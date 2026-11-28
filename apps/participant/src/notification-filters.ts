import type { NotificationItem } from "./api.ts";

/**
 * The ways someone can narrow their notifications, as apps let them: a row of chips above the
 * list (ADR 107). Each is a few kinds of notification under one word.
 */
export const NOTIFICATION_FILTERS = [
  { key: "replies", label: "Replies", types: ["reply", "tag"] },
  { key: "reactions", label: "Reactions", types: ["like", "repost", "read"] },
  { key: "follows", label: "Follows", types: ["follow"] },
  {
    key: "moderation",
    label: "Moderation",
    types: ["remove", "warn", "label", "answer", "ban", "approve", "uphold", "restore"],
  },
] as const satisfies readonly {
  key: string;
  label: string;
  types: readonly NotificationItem["type"][];
}[];

export type NotificationFilter = "all" | (typeof NOTIFICATION_FILTERS)[number]["key"];

const typesOf = (key: NotificationFilter): readonly string[] =>
  NOTIFICATION_FILTERS.find((filter) => filter.key === key)?.types ?? [];

/** Whether a notification shows under a filter. Everything shows under "all". */
export function showsUnder(filter: NotificationFilter, item: Pick<NotificationItem, "type">) {
  return filter === "all" || typesOf(filter).includes(item.type);
}

/**
 * The chips to offer for a list: All, then each filter that has something in it. With only one
 * kind of notification there's nothing to narrow, so there are none.
 */
export function filtersFor(
  items: Pick<NotificationItem, "type">[],
): { key: NotificationFilter; label: string }[] {
  const useful = NOTIFICATION_FILTERS.filter(({ types }) =>
    items.some((item) => (types as readonly string[]).includes(item.type)),
  );
  return useful.length < 2
    ? []
    : [{ key: "all", label: "All" }, ...useful.map(({ key, label }) => ({ key, label }))];
}
