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
  /** `crosspostOf` is the post a crosspost came from. */
  "content.created": z.strictObject({
    kind: z.enum(["post", "comment", "story", "message"]),
    /** For a message, who it's to, by username. */
    to: z.string().optional(),
    crosspostOf: z.string().optional(),
    /** The post this quotes. */
    quoteOf: z.string().optional(),
    /** For a story, who it's for: everyone, or only their close friends. */
    audience: z.enum(["everyone", "closeFriends"]).optional(),
    /** People in the cast they tagged in a post, by username. */
    tagged: z.array(z.string()).optional(),
  }),
  /**
   * They saw one story, for this long. `ended` is how it ended: they went on, went back, closed the
   * viewer, or its time ran out and the next began.
   */
  "story.viewed": z.strictObject({
    dwellMs: z.number().nonnegative(),
    ended: z.enum(["next", "previous", "closed", "timer"]),
    /** Where they opened it: the row of stories, or a highlight on someone's profile. */
    from: z.enum(["row", "highlight"]).optional(),
  }),
  /** They passed a post along, or took that back. It names the first post, not a repost of it. */
  "content.reposted": empty,
  "content.unreposted": empty,
  "content.liked": empty,
  "content.unliked": empty,
  /** A vote replaces the one before it. Null means they took their vote back. */
  "content.voted": z.strictObject({ value: z.enum(["up", "down"]).nullable() }),
  "content.flagged": empty,
  "content.unflagged": empty,
  /** Someone opened a post's own page. `from` is the list they came from, or "direct" if none. */
  "content.opened": z.strictObject({ from: z.string() }),
  /** They opened the website a post links to. */
  "content.link_opened": empty,
  /** They uncovered a post tagged this way. */
  "content.revealed": z.strictObject({ tags: z.array(z.enum(["spoiler", "adult"])) }),
  "content.saved": empty,
  "content.unsaved": empty,
  /** They stopped notifications about a thread, or started them again. The target is its post. */
  "content.thread_muted": empty,
  /** They pressed Show on something a label covered. The label is what it said, like "Spam". */
  "content.label_shown": z.strictObject({ label: z.string() }),
  "content.thread_unmuted": empty,
  "content.hidden": empty,
  "content.unhidden": empty,
  /** They chose an option in a poll, by its place in the list, from 0. They can't change it. */
  "content.poll_voted": z.strictObject({ option: z.number().int().nonnegative() }),
  /** They copied a link to a post. */
  "content.shared": z.strictObject({ method: z.enum(["copy"]) }),
  /** The raw time on screen. Any minimum or maximum gets applied at analysis, not here. */
  "content.viewed": z.strictObject({ dwellMs: z.number().nonnegative(), surface: z.string() }),
  "actor.followed": empty,
  "actor.unfollowed": empty,
  "actor.muted": empty,
  "actor.unmuted": empty,
  /** They put someone on their close friends list, for stories, or took them off. */
  "actor.close_friend_added": empty,
  "actor.close_friend_removed": empty,
  /** They rated a context note on a post. Null takes their rating back. `note` is its ID in the study. */
  "content.note_rated": z.strictObject({
    note: z.string(),
    value: z.enum(["helpful", "not_helpful"]).nullable(),
  }),
  "actor.blocked": empty,
  "actor.unblocked": empty,
  "actor.reported": z.strictObject({ reason: z.string() }),
  "profile.updated": z.strictObject({ fields: z.array(z.string()) }),
  "notifications.viewed": empty,
  /** They opened their conversation with someone in the cast. `targetActorId` is who. */
  "messages.opened": empty,
  /** They pressed the button on a moderator's warning. `targetContentId` is what it was about. */
  "moderation.warning_acknowledged": empty,
  /**
   * An automatic rule caught what they wrote. `rule` is its ID in the study. `unpostedText` is only
   * here if a study records what someone hasn't posted (ADR 36). Without a target, it isn't posted yet.
   */
  "moderation.rule_fired": z.strictObject({
    rule: z.string(),
    action: z.enum(["confirm", "remove", "warn", "hold"]),
    unpostedText: z.string().optional(),
  }),
  /** What they did when a rule asked if they were sure. */
  "moderation.confirm_answered": z.strictObject({
    rule: z.string(),
    choice: z.enum(["posted", "went_back"]),
  }),
  /**
   * They appealed a moderator's removal or label of what they wrote. Appeals from before labels
   * don't say, and were all of removals.
   */
  "moderation.appealed": z.strictObject({
    text: z.string(),
    of: z.enum(["removal", "label"]).optional(),
  }),
  /** Which space, by its key in the study. */
  "space.joined": z.strictObject({ space: z.string() }),
  "space.left": z.strictObject({ space: z.string() }),
  /** They chose the flair they show in a space. Null means they took it off. */
  "space.flair_chosen": z.strictObject({ space: z.string(), flair: z.string().nullable() }),
  /** Someone chose an order for a feed, where a study allows that. Null is the study's own order. */
  "feed.sort_changed": z.strictObject({
    surface: z.enum(["home", "space", "following"]),
    sort: z.enum(FEED_SORTS).nullable(),
  }),
  /** Someone chose an order for comments, where a study allows that. Null is the study's own. */
  "comments.sort_changed": z.strictObject({ sort: z.enum(COMMENT_SORTS).nullable() }),
  /** A scripted reaction was triggered by something a participant did. */
  "reaction.scheduled": z.strictObject({
    reaction: z.enum([
      "read",
      "like",
      "reply",
      "up",
      "down",
      "remove",
      "warn",
      "label",
      "answer",
      "ban",
      "hold",
      "approve",
      "uphold",
      "restore",
      "repost",
      "follow",
    ]),
    /**
     * On a removal, the reason the study wrote, if any. On a warning or answer, what it says. On a
     * label, the label.
     */
    reason: z.string().optional(),
    dueAt: z.iso.datetime(),
  }),
} as const;

export type EventType = keyof typeof eventPayloadSchemas;

export type EventPayload<T extends EventType> = z.infer<(typeof eventPayloadSchemas)[T]>;

export const EVENT_SOURCES = ["participant", "script", "llm", "researcher", "system"] as const;

export type EventSource = (typeof EVENT_SOURCES)[number];
