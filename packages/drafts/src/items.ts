import {
  ACCENT_PATTERN,
  flairSchema,
  linkSchema,
  MAX_ATTACHMENTS,
  MAX_RULE_MATCH_LENGTH,
  MAX_TITLE_LENGTH,
  PIN_PLACES,
  POST_TAGS,
  pollSchema,
} from "@truman3/core";
import { z } from "zod";

const targeting = {
  conditions: z.array(z.string()).default([]),
  class: z.string().optional(),
};

/** What each kind of item holds. Items point at each other by item ID, so renaming breaks nothing. */
export const itemDataSchemas = {
  actor: z.strictObject({
    username: z.string().min(1),
    name: z.string().min(1),
    gender: z.string().optional(),
    age: z.number().int().nonnegative().optional(),
    location: z.string().optional(),
    bio: z.string().optional(),
    picture: z.string().optional(),
    moderator: z.boolean().optional(),
    karma: z.number().int().optional(),
    followers: z.number().int().nonnegative().optional(),
    following: z.number().int().nonnegative().optional(),
    startsFollowed: z.union([z.boolean(), z.array(z.string())]).optional(),
    badge: z.string().min(1).max(40).optional(),
    /** The flair they show in each space, by the space's item ID. */
    spaceFlair: z.record(z.uuid(), z.string()).optional(),
    ...targeting,
  }),
  space: z.strictObject({
    key: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    rules: z.string().optional(),
    picture: z.string().optional(),
    banner: z.string().optional(),
    accent: z.string().regex(ACCENT_PATTERN).optional(),
    startsJoined: z.boolean().default(true),
    members: z.number().int().nonnegative().optional(),
    postFlair: z.array(flairSchema).optional(),
    userFlair: z.array(flairSchema).optional(),
    requirePostFlair: z.boolean().optional(),
    ...targeting,
  }),
  post: z.strictObject({
    ref: z.string().min(1),
    title: z.string().min(1).max(MAX_TITLE_LENGTH).optional(),
    body: z.string(),
    pictures: z.array(z.string()).max(MAX_ATTACHMENTS).optional(),
    actorId: z.uuid(),
    /** The one space it belongs to. */
    spaceId: z.uuid().optional(),
    link: linkSchema.optional(),
    pinnedOn: z.array(z.enum(PIN_PLACES)).optional(),
    locked: z.boolean().optional(),
    tags: z.array(z.enum(POST_TAGS)).optional(),
    poll: pollSchema.optional(),
    flair: z.string().min(1).optional(),
    /** The post this was crossposted from. */
    crosspostOfId: z.uuid().optional(),
    /** The post this passes along, or quotes. */
    repostOfId: z.uuid().optional(),
    quoteOfId: z.uuid().optional(),
    reposts: z.number().int().nonnegative().optional(),
    quotes: z.number().int().nonnegative().optional(),
    timeMs: z.number().int(),
    likes: z.number().int().nonnegative(),
    ups: z.number().int().nonnegative().optional(),
    downs: z.number().int().nonnegative().optional(),
    ...targeting,
  }),
  comment: z.strictObject({
    ref: z.string().min(1),
    body: z.string().min(1),
    actorId: z.uuid(),
    postId: z.uuid(),
    /** The comment this replies to, if it isn't directly on the post. */
    replyToId: z.uuid().optional(),
    timeMs: z.number().int(),
    likes: z.number().int().nonnegative(),
    ups: z.number().int().nonnegative().optional(),
    downs: z.number().int().nonnegative().optional(),
    ...targeting,
  }),
  reaction: z.strictObject({
    on: z.enum(["post", "comment"]),
    nth: z.number().int().nonnegative(),
    type: z.enum(["read", "like", "reply", "up", "down", "remove", "warn", "repost", "follow"]),
    actorId: z.uuid(),
    afterMs: z.number().int().nonnegative(),
    body: z.string().optional(),
    ...targeting,
  }),
  ban: z.strictObject({
    bannedActorId: z.uuid(),
    actorId: z.uuid(),
    timeMs: z.number().int(),
    reason: z.string().min(1).optional(),
    spaceId: z.uuid().optional(),
    ...targeting,
  }),
  reportAnswer: z.strictObject({
    reportedActorId: z.uuid().optional(),
    action: z.enum(["answer", "ban"]),
    actorId: z.uuid(),
    afterMs: z.number().int().nonnegative(),
    message: z.string().min(1).optional(),
    ...targeting,
  }),
  autoRule: z.strictObject({
    ref: z.string().min(1),
    on: z.enum(["post", "comment", "both"]),
    match: z.string().min(1).max(MAX_RULE_MATCH_LENGTH),
    action: z.enum(["confirm", "remove", "warn", "hold"]),
    actorId: z.uuid(),
    afterMs: z.number().int().nonnegative(),
    message: z.string().min(1).optional(),
    holdOutcome: z.enum(["approve", "remove"]).optional(),
    ...targeting,
  }),
  appealAnswer: z.strictObject({
    action: z.enum(["uphold", "restore"]),
    actorId: z.uuid(),
    afterMs: z.number().int().nonnegative(),
    message: z.string().min(1).optional(),
    ...targeting,
  }),
  flagAnswer: z.strictObject({
    on: z.enum(["post", "comment"]).optional(),
    targetId: z.uuid().optional(),
    action: z.enum(["remove", "answer"]),
    actorId: z.uuid(),
    afterMs: z.number().int().nonnegative(),
    message: z.string().min(1).optional(),
    ...targeting,
  }),
  removal: z.strictObject({
    on: z.enum(["post", "comment"]),
    targetId: z.uuid(),
    actorId: z.uuid(),
    timeMs: z.number().int(),
    reason: z.string().min(1).optional(),
    ...targeting,
  }),
} as const;

export type ItemKind = keyof typeof itemDataSchemas;
export type ActorData = z.infer<typeof itemDataSchemas.actor>;
export type SpaceData = z.infer<typeof itemDataSchemas.space>;
export type PostData = z.infer<typeof itemDataSchemas.post>;
export type CommentData = z.infer<typeof itemDataSchemas.comment>;
export type ReactionData = z.infer<typeof itemDataSchemas.reaction>;
export type RemovalData = z.infer<typeof itemDataSchemas.removal>;
export type FlagAnswerData = z.infer<typeof itemDataSchemas.flagAnswer>;
export type BanData = z.infer<typeof itemDataSchemas.ban>;
export type AutoRuleData = z.infer<typeof itemDataSchemas.autoRule>;
export type AppealAnswerData = z.infer<typeof itemDataSchemas.appealAnswer>;
export type ReportAnswerData = z.infer<typeof itemDataSchemas.reportAnswer>;

/**
 * Where an item came from, recorded from the start because it can't be worked out later. It belongs
 * in a methods section, and it's what will tell generated content apart from what people wrote.
 */
export interface Provenance {
  origin: "file" | "researcher" | "pack" | "generated";
  /** Whether a person has changed it since. */
  edited?: boolean;
  /** For generated content: the model and prompt. */
  detail?: Record<string, unknown>;
  /** For content from a pack: which one. */
  pack?: { id: string; name: string };
  /** For content from a pack: where it came from before that, so generated content stays marked. */
  before?: Provenance;
}

export interface DraftItem {
  id: string;
  kind: ItemKind;
  data: unknown;
  provenance: unknown;
  position: number;
}
