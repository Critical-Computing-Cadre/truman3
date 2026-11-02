import { z } from "zod";

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
  "content.flagged": empty,
  "content.unflagged": empty,
  /** The raw time on screen. Any minimum or maximum gets applied at analysis, not here. */
  "content.viewed": z.strictObject({ dwellMs: z.number().nonnegative(), surface: z.string() }),
  "actor.followed": empty,
  "actor.unfollowed": empty,
  "actor.blocked": empty,
  "actor.unblocked": empty,
  "actor.reported": z.strictObject({ reason: z.string() }),
  "profile.updated": z.strictObject({ fields: z.array(z.string()) }),
  "notifications.viewed": empty,
  /** A scripted reaction was triggered by something a participant did. */
  "reaction.scheduled": z.strictObject({
    reaction: z.enum(["read", "like", "reply"]),
    dueAt: z.iso.datetime(),
  }),
} as const;

export type EventType = keyof typeof eventPayloadSchemas;

export type EventPayload<T extends EventType> = z.infer<(typeof eventPayloadSchemas)[T]>;

export const EVENT_SOURCES = ["participant", "script", "llm", "researcher", "system"] as const;

export type EventSource = (typeof EVENT_SOURCES)[number];
