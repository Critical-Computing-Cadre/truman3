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
    ...targeting,
  }),
  post: z.strictObject({
    ref: z.string().min(1),
    body: z.string(),
    picture: z.string().optional(),
    actorId: z.uuid(),
    timeMs: z.number().int(),
    likes: z.number().int().nonnegative(),
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
    ...targeting,
  }),
  reaction: z.strictObject({
    on: z.enum(["post", "comment"]),
    nth: z.number().int().nonnegative(),
    type: z.enum(["read", "like", "reply"]),
    actorId: z.uuid(),
    afterMs: z.number().int().nonnegative(),
    body: z.string().optional(),
    ...targeting,
  }),
} as const;

export type ItemKind = keyof typeof itemDataSchemas;
export type ActorData = z.infer<typeof itemDataSchemas.actor>;
export type PostData = z.infer<typeof itemDataSchemas.post>;
export type CommentData = z.infer<typeof itemDataSchemas.comment>;
export type ReactionData = z.infer<typeof itemDataSchemas.reaction>;

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
