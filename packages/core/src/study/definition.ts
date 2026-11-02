import { z } from "zod";

const keySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Use lowercase letters, numbers, dashes, and underscores");

const rankerSchema = z.enum(["chronological", "shuffle", "scripted"]);

const feedSettingsSchema = z.strictObject({
  ranker: rankerSchema.default("chronological"),
  /** With the shuffle ranker: a new order each visit, instead of one order per participant. */
  reshuffleEachVisit: z.boolean().default(false),
  /** How far back the feed reaches, in hours. Leave out for no limit. */
  windowHours: z.number().positive().optional(),
  /** How long a participant's own new post stays on top. Leave out to not pin. */
  pinOwnPostsMinutes: z.number().positive().optional(),
  removeFlagged: z.boolean().default(false),
  removeBlocked: z.boolean().default(false),
});

/** What a condition can change. No defaults here, or leaving something out would reset it. */
const feedOverridesSchema = z.strictObject({
  ranker: rankerSchema.optional(),
  reshuffleEachVisit: z.boolean().optional(),
  windowHours: feedSettingsSchema.shape.windowHours,
  pinOwnPostsMinutes: feedSettingsSchema.shape.pinOwnPostsMinutes,
  removeFlagged: z.boolean().optional(),
  removeBlocked: z.boolean().optional(),
});

/**
 * What kind of platform this is, which decides what participants' posts must contain. A photo
 * platform is like Instagram, a text platform is like X, and mixed takes either.
 */
const platformStyleSchema = z.enum(["photo", "text", "mixed"]);

/**
 * Whether the comment box is under every post, as on Facebook, or appears after pressing Reply.
 * Leaving it out means `open`.
 */
const commentBoxSchema = z.enum(["open", "onReply"]);

const armSchema = z.strictObject({
  key: keySchema,
  /** Labels for multi-factor designs, so exports can split by factor. */
  factors: z.record(z.string(), z.string()).default({}),
  weight: z.number().int().positive().default(1),
  /** Settings that differ in this condition. */
  feed: feedOverridesSchema.optional(),
  platform: z
    .strictObject({
      style: platformStyleSchema.optional(),
      commentBox: commentBoxSchema.optional(),
    })
    .optional(),
});

const assignmentSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("uniform") }),
  z.strictObject({ method: z.literal("blocked"), blockSize: z.number().int().positive() }),
]);

const flowStepSchema = z.discriminatedUnion("step", [
  z.strictObject({
    step: z.literal("consent"),
    page: z.string().min(1),
    /** What someone sees after declining. On Prolific, this should say to return their submission. */
    declineMessage: z.string().min(1).optional(),
    /** Where to send someone after declining, instead of showing a message. */
    declineRedirect: z.url().optional(),
  }),
  z.strictObject({ step: z.literal("account") }),
  z.strictObject({ step: z.literal("page"), page: z.string().min(1) }),
  z.strictObject({
    step: z.literal("feed"),
    /** When a participant may choose to move on. Leave out to keep them here until the study ends. */
    finishAfterMinutes: z.number().nonnegative().optional(),
  }),
  z.strictObject({ step: z.literal("exit"), redirect: z.url().optional() }),
]);

const likeDistributionSchema = z.array(z.number().int().nonnegative()).min(1);

/** The settings for a study: everything that isn't a list of actors or content. */
export const studySettingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  slug: keySchema,
  title: z.string().min(1),
  site: z.strictObject({
    name: z.string().min(1),
    logo: z.string().optional(),
    favicon: z.string().optional(),
    homepageImage: z.string().optional(),
  }),
  length: z.strictObject({ days: z.number().positive() }),
  entry: z.strictObject({
    /** The URL parameter holding the participant's recruitment ID, e.g. PROLIFIC_PID. */
    idParam: z.string().min(1),
    /** What to call that ID when asking a participant to type it. */
    idLabel: z.string().min(1),
    source: z.string().min(1),
  }),
  conditions: z.strictObject({
    /** Required, with no default: this is a design decision for the researcher. */
    assignment: assignmentSchema,
    arms: z.array(armSchema).min(1),
  }),
  platform: z
    .strictObject({ style: platformStyleSchema, commentBox: commentBoxSchema.optional() })
    .prefault({ style: "mixed" }),
  feed: feedSettingsSchema.prefault({}),
  /**
   * Values to draw from, with equal chance, for content that doesn't set its own like count.
   * Repeat a value to make it more likely. Leave out for zero likes.
   */
  likes: z
    .strictObject({
      posts: likeDistributionSchema.optional(),
      comments: likeDistributionSchema.optional(),
    })
    .default({}),
  media: z
    .strictObject({
      /** Where media is hosted, if not in the study folder, e.g. a private CDN. */
      baseUrl: z.url().optional(),
    })
    .default({}),
  privacy: z
    .strictObject({
      storeIpAddress: z.boolean().default(false),
    })
    .default({ storeIpAddress: false }),
  flow: z.array(flowStepSchema).min(1),
});

/** Where an item came from, so errors can point at it. Spreadsheets count the header as row 1. */
const sourceSchema = z.object({ file: z.string(), row: z.number().int().positive() }).optional();

const targetingFields = {
  /** The condition keys this applies to. Empty means all conditions. */
  conditions: z.array(z.string()).default([]),
  /** A free-form label carried through to exports. */
  class: z.string().optional(),
  source: sourceSchema,
};

export const actorDefinitionSchema = z.object({
  username: z.string().min(1),
  name: z.string().min(1),
  gender: z.string().optional(),
  age: z.number().int().nonnegative().optional(),
  location: z.string().optional(),
  bio: z.string().optional(),
  picture: z.string().optional(),
  ...targetingFields,
});

export const postDefinitionSchema = z.object({
  ref: z.string().min(1),
  body: z.string(),
  picture: z.string().optional(),
  actor: z.string().min(1),
  /** Milliseconds relative to when a participant starts. */
  timeMs: z.number().int(),
  likes: z.number().int().nonnegative().optional(),
  ...targetingFields,
});

export const commentDefinitionSchema = z.object({
  ref: z.string().min(1),
  body: z.string().min(1),
  actor: z.string().min(1),
  post: z.string().min(1),
  timeMs: z.number().int(),
  likes: z.number().int().nonnegative().optional(),
  ...targetingFields,
});

export const reactionDefinitionSchema = z.object({
  /** What the participant did to trigger this: their nth post or comment. */
  on: z.enum(["post", "comment"]),
  /** Which one, counting from 0. */
  nth: z.number().int().nonnegative(),
  type: z.enum(["read", "like", "reply"]),
  actor: z.string().min(1),
  /** Milliseconds after the participant's post or comment. */
  afterMs: z.number().int().nonnegative(),
  body: z.string().optional(),
  ...targetingFields,
});

/**
 * A complete study, however it was authored. Files, a visual builder, or an agent can all
 * produce one of these (see ADR 10).
 */
export const studyDefinitionSchema = z.object({
  settings: studySettingsSchema,
  /** The text of each page used in the flow, keyed by the name the flow uses. */
  pages: z.record(z.string(), z.string()).default({}),
  actors: z.array(actorDefinitionSchema),
  posts: z.array(postDefinitionSchema),
  comments: z.array(commentDefinitionSchema).default([]),
  reactions: z.array(reactionDefinitionSchema).default([]),
});

export type StudySettings = z.infer<typeof studySettingsSchema>;
export type StudyDefinition = z.infer<typeof studyDefinitionSchema>;
export type ActorDefinition = z.infer<typeof actorDefinitionSchema>;
export type PostDefinition = z.infer<typeof postDefinitionSchema>;
export type CommentDefinition = z.infer<typeof commentDefinitionSchema>;
export type ReactionDefinition = z.infer<typeof reactionDefinitionSchema>;
