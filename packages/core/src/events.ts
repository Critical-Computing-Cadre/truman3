import { z } from "zod";
import { COMMENT_SORTS, FEED_SORTS } from "./orders.ts";

const empty = z.strictObject({});

/**
 * Every kind of event, and the details each one carries. A new event type starts here. See
 * docs/adr/0006-append-only-event-log.md for what does and doesn't get written as an event.
 */
export const eventPayloadSchemas = {
  "session.started": z.strictObject({
    device: z.enum(["phone", "tablet", "desktop", "unknown"]),
    browser: z.string(),
    /** Only present when a study turns on privacy.storeIpAddress. */
    ipAddress: z.string().optional(),
  }),
  "session.heartbeat": z.strictObject({ activeMs: z.number().nonnegative(), page: z.string() }),
  "page.viewed": z.strictObject({ page: z.string() }),
  "flow.step_completed": z.strictObject({ step: z.string() }),
  "flow.exited": z.strictObject({ outcome: z.string() }),
  "content.created": z.strictObject({ kind: z.enum(["post", "comment"]) }),
  "content.liked": empty,
  "content.unliked": empty,
  /** A vote replaces the one before it. Null means they took their vote back. */
  "content.voted": z.strictObject({ value: z.enum(["up", "down"]).nullable() }),
  "content.flagged": empty,
  "content.unflagged": empty,
  /** Someone opened a post's own page. `from` is the list they came from, or "direct" if none. */
  "content.opened": z.strictObject({ from: z.string() }),
  /** The raw time on screen. Any minimum or maximum gets applied at analysis, not here. */
  "content.viewed": z.strictObject({ dwellMs: z.number().nonnegative(), surface: z.string() }),
  "actor.followed": empty,
  "actor.unfollowed": empty,
  "actor.blocked": empty,
  "actor.unblocked": empty,
  "actor.reported": z.strictObject({ reason: z.string() }),
  "profile.updated": z.strictObject({ fields: z.array(z.string()) }),
  "notifications.viewed": empty,
  /** Which space, by its key in the study. */
  "space.joined": z.strictObject({ space: z.string() }),
  "space.left": z.strictObject({ space: z.string() }),
  /** Someone chose an order for a feed, where a study allows that. Null is the study's own order. */
  "feed.sort_changed": z.strictObject({
    surface: z.enum(["home", "space"]),
    sort: z.enum(FEED_SORTS).nullable(),
  }),
  /** Someone chose an order for comments, where a study allows that. Null is the study's own. */
  "comments.sort_changed": z.strictObject({ sort: z.enum(COMMENT_SORTS).nullable() }),
  /** A scripted reaction was triggered by something a participant did. */
  "reaction.scheduled": z.strictObject({
    reaction: z.enum(["read", "like", "reply", "up", "down"]),
    dueAt: z.iso.datetime(),
  }),
} as const;

export type EventType = keyof typeof eventPayloadSchemas;

export type EventPayload<T extends EventType> = z.infer<(typeof eventPayloadSchemas)[T]>;

export const EVENT_SOURCES = ["participant", "script", "llm", "researcher", "system"] as const;

export type EventSource = (typeof EVENT_SOURCES)[number];
