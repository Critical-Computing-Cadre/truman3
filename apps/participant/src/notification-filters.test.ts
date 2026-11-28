import { describe, expect, it } from "vitest";
import { filtersFor, NOTIFICATION_FILTERS, showsUnder } from "./notification-filters.ts";

const of = (...types: string[]) => types.map((type) => ({ type })) as { type: "like" }[];

describe("narrowing notifications", () => {
  it("offers All and each filter that has something in it", () => {
    expect(filtersFor(of("like", "reply", "like", "remove")).map(({ label }) => label)).toEqual([
      "All",
      "Replies",
      "Reactions",
      "Moderation",
    ]);
  });

  it("offers nothing when there's only one kind, or nothing at all", () => {
    expect(filtersFor(of("like", "repost", "read"))).toEqual([]);
    expect(filtersFor([])).toEqual([]);
  });

  it("shows everything under All, and only its own kinds under a filter", () => {
    const like = { type: "like" } as const;
    const reply = { type: "reply" } as const;
    const follow = { type: "follow" } as const;
    expect([like, reply, follow].filter((item) => showsUnder("all", item))).toHaveLength(3);
    expect(showsUnder("replies", reply)).toBe(true);
    expect(showsUnder("replies", like)).toBe(false);
    expect(showsUnder("follows", follow)).toBe(true);
  });

  it("puts every kind of notification under exactly one filter", () => {
    const all = NOTIFICATION_FILTERS.flatMap(({ types }) => [...types]);
    expect(new Set(all).size).toBe(all.length);
    // Every kind the API sends (NotificationItem's `type`). A new kind has to be put somewhere.
    expect([...all].sort()).toEqual(
      [
        "answer",
        "approve",
        "ban",
        "follow",
        "label",
        "like",
        "read",
        "remove",
        "reply",
        "repost",
        "restore",
        "tag",
        "uphold",
        "warn",
      ].sort(),
    );
  });
});
