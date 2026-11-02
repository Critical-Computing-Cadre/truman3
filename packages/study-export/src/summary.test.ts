import { describe, expect, it } from "vitest";
import { type SummarizableEvent, summarizeEvents } from "./summary.ts";

const event = (
  type: string,
  target: string | null = null,
  payload: object = {},
): SummarizableEvent => ({ type, targetContentId: target, targetActorId: target, payload });

describe("summarizeEvents", () => {
  it("counts what's still liked separately from every click", () => {
    const summary = summarizeEvents([
      event("content.liked", "a"),
      event("content.unliked", "a"),
      event("content.liked", "a"),
      event("content.liked", "b"),
      event("content.unliked", "b"),
    ]);

    expect(summary.contentLiked).toBe(1);
    expect(summary.likeActions).toBe(3);
  });

  it("includes actions on any content", () => {
    expect(
      summarizeEvents([
        event("content.created", "p", { kind: "post" }),
        event("content.created", "c", { kind: "comment" }),
        event("content.created", "d", { kind: "comment" }),
        event("content.flagged", "x"),
        event("content.flagged", "y"),
        event("content.unflagged", "y"),
      ]),
    ).toMatchObject({ postsCreated: 1, commentsCreated: 2, contentFlagged: 1, flagActions: 2 });
  });

  it("does the same for actors", () => {
    expect(
      summarizeEvents([
        event("actor.followed", "a"),
        event("actor.followed", "b"),
        event("actor.unfollowed", "b"),
        event("actor.blocked", "c"),
        event("actor.unblocked", "c"),
        event("actor.reported", "d", { reason: "spam" }),
      ]),
    ).toMatchObject({ actorsFollowed: 1, actorsBlocked: 0, actorsReported: 1 });
  });

  it("adds up sessions, pages, and active time", () => {
    expect(
      summarizeEvents([
        event("session.started"),
        event("session.started"),
        event("page.viewed", null, { page: "/" }),
        event("session.heartbeat", null, { activeMs: 15000, page: "/" }),
        event("session.heartbeat", null, { activeMs: 5000, page: "/" }),
      ]),
    ).toMatchObject({ sessions: 2, pagesViewed: 1, activeMs: 20000 });
  });

  describe("time on content", () => {
    const views = [100, 1500, 3000, 90_000_000].map((dwellMs) =>
      event("content.viewed", "p", { dwellMs, surface: "feed" }),
    );

    it("counts everything by default, with no threshold built in", () => {
      expect(summarizeEvents(views)).toMatchObject({
        contentViews: 4,
        dwellMs: 90_004_600,
        viewsExcluded: 0,
      });
    });

    it("applies limits the researcher asks for, and says how many it excluded", () => {
      expect(summarizeEvents(views, { minDwellMs: 1500, maxDwellMs: 86_400_000 })).toMatchObject({
        contentViews: 2,
        dwellMs: 4500,
        viewsExcluded: 2,
      });
    });
  });

  it("doesn't let the old export's bug happen: an action on a post always counts", () => {
    // truman_2023's data-export.js checked the list rather than the item, so it counted nothing.
    expect(summarizeEvents([event("content.liked", "a")]).contentLiked).toBe(1);
  });
});
