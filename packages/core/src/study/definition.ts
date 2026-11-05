import { z } from "zod";
import { ACCENT_PATTERN } from "../color.ts";
import { FEATURE_KEYS } from "../features/catalog.ts";
import { LAYOUT_KEYS, TEMPLATE_KEYS } from "../features/templates.ts";
import { COMMENT_SORTS, FEED_SORTS } from "../orders.ts";
import { flairSchema, pollSchema } from "../polls-flair.ts";
import { linkSchema, PIN_PLACES, POST_TAGS } from "../post-extras.ts";

const keySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Use lowercase letters, numbers, dashes, and underscores");

const rankerSchema = z.enum(["chronological", "shuffle", "scripted", ...FEED_SORTS]);

/** How comments on a post are ordered. Replies stay under what they reply to in every one. */
const commentOrderSchema = z.enum(["scripted", ...COMMENT_SORTS]);

/**
 * A scripted change to someone's karma, some time after a participant starts. It says who by
 * username, and leaving that out means the participant. Changes add up.
 */
const karmaChangeSchema = z.strictObject({
  actor: z.string().min(1).optional(),
  afterMinutes: z.number().int().nonnegative(),
  change: z.number().int(),
});
export type KarmaChange = z.infer<typeof karmaChangeSchema>;

/** The longest a post's title can be. */
export const MAX_TITLE_LENGTH = 300;

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
  /** The order on a space's own page. Leave out to use the same one as the home feed. */
  spaceRanker: rankerSchema.optional(),
  /** Whether participants can choose new or top themselves. Leave out for no. */
  participantsCanSort: z.boolean().optional(),
  /** The order of comments on a post. Leave out for the template's, or else the scripted order. */
  commentOrder: commentOrderSchema.optional(),
  /** Whether participants can choose top or new for comments themselves. Leave out for no. */
  participantsCanSortComments: z.boolean().optional(),
});

/** What a condition can change. No defaults here, or leaving something out would reset it. */
const feedOverridesSchema = z.strictObject({
  ranker: rankerSchema.optional(),
  reshuffleEachVisit: z.boolean().optional(),
  windowHours: feedSettingsSchema.shape.windowHours,
  pinOwnPostsMinutes: feedSettingsSchema.shape.pinOwnPostsMinutes,
  removeFlagged: z.boolean().optional(),
  removeBlocked: z.boolean().optional(),
  spaceRanker: rankerSchema.optional(),
  participantsCanSort: z.boolean().optional(),
  commentOrder: commentOrderSchema.optional(),
  participantsCanSortComments: z.boolean().optional(),
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

/** Features to turn on or off. Whatever's left out comes from the template. */
const featureChangesSchema = z.partialRecord(z.enum(FEATURE_KEYS), z.boolean());

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
      features: featureChangesSchema.optional(),
      canJoinSpaces: z.boolean().optional(),
      startingKarma: z.number().int().optional(),
      /** Replaces the study's list for this condition. */
      karmaChanges: z.array(karmaChangeSchema).optional(),
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
    .strictObject({
      style: platformStyleSchema,
      commentBox: commentBoxSchema.optional(),
      /** The starting point for this platform. Leave out for Classic. */
      template: z.enum(TEMPLATE_KEYS).optional(),
      /** Set when a version freezes, so later changes to a template can't affect it. */
      layout: z.enum(LAYOUT_KEYS).optional(),
      features: featureChangesSchema.optional(),
      /** Whether participants can join and leave spaces. Leave out for yes. */
      canJoinSpaces: z.boolean().optional(),
      /** A participant's karma before any votes on what they post. Leave out for zero. */
      startingKarma: z.number().int().optional(),
      /** Scripted changes to karma during the study. */
      karmaChanges: z.array(karmaChangeSchema).optional(),
    })
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
  /** Shows a tag on their name. It doesn't give them any powers. */
  moderator: z.boolean().optional(),
  /** Their points, on a platform with karma. */
  karma: z.number().int().optional(),
  /** The flair they show in each space, by the space's key, on a platform with flair. */
  spaceFlair: z.record(z.string(), z.string()).optional(),
  ...targetingFields,
});

/** A community posts can belong to. Only researchers make these. */
export const spaceDefinitionSchema = z.object({
  /** What posts use to name it, and part of its address. */
  key: keySchema,
  name: z.string().min(1),
  description: z.string().optional(),
  rules: z.string().optional(),
  /** Its picture, in media/spaces. */
  picture: z.string().optional(),
  /** A wide image across the top of its page, in media/spaces. */
  banner: z.string().optional(),
  /** Its color, as #rrggbb. Any color works, since what goes on it is chosen to be readable. */
  accent: z.string().regex(ACCENT_PATTERN, "Use a color like #1d4ed8.").optional(),
  /** Whether a participant starts out in it. */
  startsJoined: z.boolean().default(true),
  /** How many members it says it has, before this participant. Leave out to show no number. */
  members: z.number().int().nonnegative().optional(),
  /** What posts in it can be labeled with, on a platform with flair. */
  postFlair: z.array(flairSchema).optional(),
  /** What people in it can show beside their name, on a platform with flair. */
  userFlair: z.array(flairSchema).optional(),
  /** Whether a post someone writes here has to have flair. */
  requirePostFlair: z.boolean().optional(),
  ...targetingFields,
});

export const postDefinitionSchema = z.object({
  ref: z.string().min(1),
  /** Its title, on a platform with titles. */
  title: z.string().min(1).max(MAX_TITLE_LENGTH).optional(),
  body: z.string(),
  /** Its photos, in order. */
  pictures: z.array(z.string().min(1)).default([]),
  /** The key of the one space it belongs to, if any. */
  space: z.string().min(1).optional(),
  /** Where it links to, on a platform with link posts. */
  link: linkSchema.optional(),
  /** Which lists it stays on top of, on a platform with pinned posts. */
  pinnedOn: z.array(z.enum(PIN_PLACES)).optional(),
  /** Whether nobody can comment on it, on a platform with locked posts. */
  locked: z.boolean().optional(),
  /** Why it's covered until clicked, on a platform with those tags. */
  tags: z.array(z.enum(POST_TAGS)).optional(),
  /** Its poll, on a platform with polls. */
  poll: pollSchema.optional(),
  /** Its label, from its space's list, on a platform with flair. */
  flair: z.string().min(1).optional(),
  /** The post this was crossposted from, by its ID in this study. */
  crosspostOf: z.string().min(1).optional(),
  actor: z.string().min(1),
  /** Milliseconds relative to when a participant starts. */
  timeMs: z.number().int(),
  likes: z.number().int().nonnegative().optional(),
  /** The scripted votes it starts with. */
  ups: z.number().int().nonnegative().optional(),
  downs: z.number().int().nonnegative().optional(),
  ...targetingFields,
});

export const commentDefinitionSchema = z.object({
  ref: z.string().min(1),
  body: z.string().min(1),
  actor: z.string().min(1),
  post: z.string().min(1),
  /** The comment this replies to, if it isn't directly on the post. */
  replyTo: z.string().min(1).optional(),
  timeMs: z.number().int(),
  likes: z.number().int().nonnegative().optional(),
  /** The scripted votes it starts with. */
  ups: z.number().int().nonnegative().optional(),
  downs: z.number().int().nonnegative().optional(),
  ...targetingFields,
});

export const reactionDefinitionSchema = z.object({
  /** What the participant did to trigger this: their nth post or comment. */
  on: z.enum(["post", "comment"]),
  /** Which one, counting from 0. */
  nth: z.number().int().nonnegative(),
  type: z.enum(["read", "like", "reply", "up", "down", "remove", "warn"]),
  actor: z.string().min(1),
  /** Milliseconds after the participant's post or comment. */
  afterMs: z.number().int().nonnegative(),
  /** A reply's or warning's text, or the reason given for a removal. */
  body: z.string().optional(),
  ...targetingFields,
});

/** A moderator taking down something the study wrote, at a set time. */
export const removalDefinitionSchema = z.object({
  on: z.enum(["post", "comment"]),
  /** The post or comment, by its ID in this study. */
  target: z.string().min(1),
  /** The moderator, who can be anyone in the cast, including an account named as automatic. */
  actor: z.string().min(1),
  /** Milliseconds relative to when a participant starts. */
  timeMs: z.number().int(),
  /** What they say about why. Leave out to give none. */
  reason: z.string().min(1).optional(),
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
  spaces: z.array(spaceDefinitionSchema).default([]),
  posts: z.array(postDefinitionSchema),
  comments: z.array(commentDefinitionSchema).default([]),
  reactions: z.array(reactionDefinitionSchema).default([]),
  removals: z.array(removalDefinitionSchema).default([]),
});

export type StudySettings = z.infer<typeof studySettingsSchema>;
export type StudyDefinition = z.infer<typeof studyDefinitionSchema>;
export type ActorDefinition = z.infer<typeof actorDefinitionSchema>;
export type SpaceDefinition = z.infer<typeof spaceDefinitionSchema>;
export type PostDefinition = z.infer<typeof postDefinitionSchema>;
export type CommentDefinition = z.infer<typeof commentDefinitionSchema>;
export type ReactionDefinition = z.infer<typeof reactionDefinitionSchema>;
export type RemovalDefinition = z.infer<typeof removalDefinitionSchema>;
