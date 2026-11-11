import { z } from "zod";
import { MAX_RULE_MATCH_LENGTH } from "../auto-rules.ts";
import { ACCENT_PATTERN } from "../color.ts";
import { FEATURE_KEYS } from "../features/catalog.ts";
import { LAYOUT_KEYS, TEMPLATE_KEYS } from "../features/templates.ts";
import { COMMENT_SORTS, FEED_SORTS } from "../orders.ts";
import { flairSchema, pollSchema } from "../polls-flair.ts";
import { linkSchema, PIN_PLACES, POST_TAGS } from "../post-extras.ts";
import type { BeatDefinition, BeatsFile } from "./beats.ts";
import type { PersonasFile } from "./personas.ts";
import type { Scenario } from "./scenarios.ts";

/** How long a place on a post can be. */
export const MAX_PLACE_LENGTH = 80;

/** In a post's `tagged`, stands for whoever is taking part. */
export const PARTICIPANT_TAG = "{participant}";

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

/** Something said to be trending. A study writes these, and they don't come from what's posted. */
export const trendingItemSchema = z.strictObject({
  /** The hashtag it links to, without the #. */
  tag: z.string().min(1).max(100),
  /** What it says beside it, such as "12K posts". */
  note: z.string().max(100).optional(),
  /** When it starts showing, in minutes after someone starts. Leave out for from the start. */
  afterMinutes: z.number().int().nonnegative().optional(),
});
export type TrendingItem = z.infer<typeof trendingItemSchema>;

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
  /** The order of the following tab. Leave out for newest first. */
  followingRanker: rankerSchema.optional(),
  /** What the two tabs are called. Leave out for "For you" and "Following". */
  homeTabLabel: z.string().min(1).max(30).optional(),
  followingTabLabel: z.string().min(1).max(30).optional(),
  /** Which tab someone sees first. Leave out for the study's feed. */
  startOnFollowing: z.boolean().optional(),
  /** Keeps ads apart, with one after every this many other posts. Leave out to order them like any post. */
  adEvery: z.number().int().positive().optional(),
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
  adEvery: z.number().int().positive().optional(),
  followingRanker: rankerSchema.optional(),
  homeTabLabel: feedSettingsSchema.shape.homeTabLabel,
  followingTabLabel: feedSettingsSchema.shape.followingTabLabel,
  startOnFollowing: z.boolean().optional(),
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

/** Light, dark, or whatever the participant's device uses. */
export const themeSchema = z.enum(["light", "dark", "device"]);

/** Which button an "are you sure?" box makes the dark one, the one it nudges people toward. */
export const sureButtonSchema = z.enum(["goBack", "postAnyway"]);

/** Features to turn on or off. Whatever's left out comes from the template. */
const featureChangesSchema = z.partialRecord(z.enum(FEATURE_KEYS), z.boolean());

const armSchema = z.strictObject({
  key: keySchema,
  /** Labels for multi-factor designs, so exports can split by factor. */
  factors: z.record(z.string(), z.string()).default({}),
  /**
   * How often it's assigned when someone joins, relative to the others. 0 for a condition someone
   * only reaches at a decision point, in an adaptive design.
   */
  weight: z.number().int().nonnegative().default(1),
  /** Settings that differ in this condition. */
  feed: feedOverridesSchema.optional(),
  platform: z
    .strictObject({
      style: platformStyleSchema.optional(),
      commentBox: commentBoxSchema.optional(),
      /** Light unless a study says otherwise, so what people see doesn't vary by device. */
      theme: themeSchema.optional(),
      /** "Go back and edit" unless a study says otherwise. */
      sureButton: sureButtonSchema.optional(),
      features: featureChangesSchema.optional(),
      canJoinSpaces: z.boolean().optional(),
      startingKarma: z.number().int().optional(),
      recordUnpostedText: z.boolean().optional(),
      maxPostLength: z.number().int().positive().optional(),
      startingFollowers: z.number().int().nonnegative().optional(),
      trending: z.array(trendingItemSchema).optional(),
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
    /** A page of community rules, like pages/rules.md, that participants can open any time. */
    rules: z.string().min(1).optional(),
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
      /** Light unless a study says otherwise, so what people see doesn't vary by device. */
      theme: themeSchema.optional(),
      /** Which button an "are you sure?" box makes dark. "Go back and edit" unless a study says. */
      sureButton: sureButtonSchema.optional(),
      /** The starting point for this platform. Leave out for Classic. */
      template: z.enum(TEMPLATE_KEYS).optional(),
      /** Set when a version freezes, so later changes to a template can't affect it. */
      layout: z.enum(LAYOUT_KEYS).optional(),
      features: featureChangesSchema.optional(),
      /** Whether participants can join and leave spaces. Leave out for yes. */
      canJoinSpaces: z.boolean().optional(),
      /** A participant's karma before any votes on what they post. Leave out for zero. */
      startingKarma: z.number().int().optional(),
      /**
       * Whether to keep what someone wrote when a rule asks if they're sure, even if they never post
       * it. Off unless a study turns it on, since it's text someone chose not to share.
       */
      recordUnpostedText: z.boolean().optional(),
      /** The most a participant can write in a post or comment. Leave out for no limit. */
      maxPostLength: z.number().int().positive().optional(),
      /** What's said to be trending, on a platform with that. */
      trending: z.array(trendingItemSchema).optional(),
      /** How many followers a participant starts with, on a platform that shows them. */
      startingFollowers: z.number().int().nonnegative().optional(),
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
  /** A different picture in some conditions, by condition key, such as one with a frame. */
  conditionPictures: z.record(z.string(), z.string()).optional(),
  /** A wide picture across the top of their profile, in media/actors, on a layout that has one. */
  banner: z.string().optional(),
  /** Shows a tag on their name. It doesn't give them any powers. */
  moderator: z.boolean().optional(),
  /** Their points, on a platform with karma. */
  karma: z.number().int().optional(),
  /** How many follow them and they follow, on a platform that shows those. */
  followers: z.number().int().nonnegative().optional(),
  following: z.number().int().nonnegative().optional(),
  /** Whether a participant starts out following them: true for everyone, or a list of conditions. */
  startsFollowed: z.union([z.boolean(), z.array(z.string())]).optional(),
  /** A label beside their name, on a platform with badges. */
  badge: z.string().min(1).max(40).optional(),
  /** Whether they're suggested for following, on a platform with that. */
  suggested: z.boolean().optional(),
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
  /** The post this passes along, by its ID. It can be another repost, which makes a chain. */
  repostOf: z.string().min(1).optional(),
  /** The post this quotes, by its ID in this study. */
  quoteOf: z.string().min(1).optional(),
  /** Someone in the cast who liked it, by username, for "Liked by ... and others." */
  likedBy: z.string().min(1).optional(),
  /** Where it says it was, such as "Ithaca, New York". */
  place: z.string().min(1).max(MAX_PLACE_LENGTH).optional(),
  /** People in the cast tagged in it, by username. */
  /** `{participant}` tags whoever is taking part. */
  tagged: z.array(z.string().min(1)).optional(),
  /** Marks it as an ad, with this label, such as "Sponsored". */
  ad: z.string().min(1).max(40).optional(),
  /** How many it says have seen it. */
  views: z.number().int().nonnegative().optional(),
  /** How many it says have passed it along or quoted it, before anything in the study. */
  reposts: z.number().int().nonnegative().optional(),
  quotes: z.number().int().nonnegative().optional(),
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
  on: z.enum(["post", "comment", "story"]),
  /** Which one, counting from 0. */
  nth: z.number().int().nonnegative(),
  type: z.enum([
    "read",
    "like",
    "reply",
    "up",
    "down",
    "remove",
    "warn",
    "label",
    "repost",
    "follow",
  ]),
  actor: z.string().min(1),
  /** Milliseconds after the participant's post or comment. */
  afterMs: z.number().int().nonnegative(),
  /** A reply's or warning's text, the reason given for a removal, or a label. */
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

/** The longest a label can be, so it fits on one line over a post. */
export const MAX_LABEL_LENGTH = 40;

/**
 * A moderator labeling something the study wrote, at a set time, such as "Spam". A label can cover
 * what it's on until someone presses Show, or sit above it.
 */
export const labelDefinitionSchema = z.object({
  on: z.enum(["post", "comment"]),
  /** The post or comment, by its ID in this study. */
  target: z.string().min(1),
  actor: z.string().min(1),
  /** Milliseconds relative to when a participant starts. */
  timeMs: z.number().int(),
  label: z.string().min(1).max(MAX_LABEL_LENGTH),
  /** Whether it covers the post until someone presses Show. */
  hides: z.boolean().default(false),
  reason: z.string().min(1).optional(),
  /** Whether it says who gave it. A notice from nobody in particular doesn't. */
  showsWho: z.boolean().default(true),
  /** A yes-or-no question it asks, such as "Do you agree with this flag?" The answer is recorded. */
  ask: z.string().min(1).max(200).optional(),
  ...targetingFields,
});

/** What a moderator does when someone flags something. One naming a target beats one that doesn't. */
export const flagAnswerDefinitionSchema = z.object({
  /** What kind of thing `target` is. */
  on: z.enum(["post", "comment"]).optional(),
  /** The post or comment, by its ID in this study. Leave out to answer any flag. */
  target: z.string().min(1).optional(),
  action: z.enum(["remove", "answer"]),
  actor: z.string().min(1),
  /** Milliseconds after they flag it. */
  afterMs: z.number().int().nonnegative(),
  /** What an answer says, or the reason given for a removal. */
  message: z.string().min(1).optional(),
  ...targetingFields,
});

/** A moderator banning someone in the cast. They seem to stop posting from then on. */
export const banDefinitionSchema = z.object({
  /** Who's banned, by username. */
  user: z.string().min(1),
  /** The moderator. */
  actor: z.string().min(1),
  /** Milliseconds relative to when a participant starts. */
  timeMs: z.number().int(),
  reason: z.string().min(1).optional(),
  /** The one space they're banned from, by key. Leave out for everywhere. */
  space: z.string().min(1).optional(),
  ...targetingFields,
});

/** What a moderator does when someone reports a person. One naming them beats one that doesn't. */
export const reportAnswerDefinitionSchema = z.object({
  /** Who's reported, by username. Leave out to answer any report. */
  user: z.string().min(1).optional(),
  action: z.enum(["answer", "ban"]),
  /** The moderator. */
  actor: z.string().min(1),
  /** Milliseconds after they report them. */
  afterMs: z.number().int().nonnegative(),
  /** What an answer says, or the reason given for a ban. */
  message: z.string().min(1).optional(),
  ...targetingFields,
});

/** Words in what a participant writes bringing a moderator's response. The first that matches applies. */
export const autoRuleDefinitionSchema = z.object({
  /** What records call it. */
  ref: z.string().min(1),
  on: z.enum(["post", "comment", "both"]),
  /** Words and phrases, separated by |. One ending in * matches the start of a word. */
  match: z.string().min(1).max(MAX_RULE_MATCH_LENGTH),
  action: z.enum(["confirm", "remove", "warn", "hold"]),
  /** The moderator, who can be an account named as automatic. */
  actor: z.string().min(1),
  /** Milliseconds after they write it. For a hold, how long until it's decided. */
  afterMs: z.number().int().nonnegative(),
  /** What it says when it asks, warns, or removes. */
  message: z.string().min(1).optional(),
  /** How a hold ends. Leave out for approved. */
  holdOutcome: z.enum(["approve", "remove"]).optional(),
  ...targetingFields,
});

/** What a moderator says to an appeal. The first that applies to someone's condition is used. */
export const appealAnswerDefinitionSchema = z.object({
  /** Whether the removal stands, or what was removed goes back. */
  action: z.enum(["uphold", "restore"]),
  actor: z.string().min(1),
  afterMs: z.number().int().nonnegative(),
  message: z.string().min(1).optional(),
  ...targetingFields,
});

/** A photo someone in the cast posts as a story, at a set time, which lasts a set time. */
export const storyDefinitionSchema = z.object({
  /** What records call it. */
  ref: z.string().min(1),
  actor: z.string().min(1),
  /** In media/posts. Empty only while a draft is being written, and validation refuses that. */
  picture: z.string(),
  caption: z.string().max(500).optional(),
  /** Milliseconds relative to when a participant starts. */
  timeMs: z.number().int(),
  /** How long it lasts. Leave out for a day. */
  lastsHours: z.number().positive().optional(),
  /** Keeps it on its poster's profile, in a highlight with this name, after it's gone from the row. */
  highlight: z.string().min(1).max(40).optional(),
  /** Only for the poster's close friends, which the participant is shown to be one of. */
  closeFriends: z.boolean().optional(),
  ...targetingFields,
});

/** A note on a post, as if readers had added context, from a set time. Only the first due one shows. */
export const contextNoteDefinitionSchema = z.object({
  /** What records call it. */
  ref: z.string().min(1),
  /** The post, by its ID in this study. */
  post: z.string().min(1),
  body: z.string().min(1).max(2000),
  /** Milliseconds relative to when a participant starts. */
  timeMs: z.number().int(),
  /** How many it says have rated it each way. */
  helpful: z.number().int().nonnegative().optional(),
  notHelpful: z.number().int().nonnegative().optional(),
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
  labels: z.array(labelDefinitionSchema).default([]),
  flagAnswers: z.array(flagAnswerDefinitionSchema).default([]),
  bans: z.array(banDefinitionSchema).default([]),
  reportAnswers: z.array(reportAnswerDefinitionSchema).default([]),
  autoRules: z.array(autoRuleDefinitionSchema).default([]),
  appealAnswers: z.array(appealAnswerDefinitionSchema).default([]),
  contextNotes: z.array(contextNoteDefinitionSchema).default([]),
  stories: z.array(storyDefinitionSchema).default([]),
  /** What Christof makes happen, read from beats.yaml, which is kept among the pages as written. */
  beats: z.array(z.custom<BeatDefinition>((value) => typeof value === "object")).default([]),
  /** Scenario tests, from scenarios.yaml, which is kept among the pages as written. */
  scenarios: z.array(z.custom<Scenario>((value) => typeof value === "object")).default([]),
  /** Who simulated participants play, from personas.yaml, which is kept among the pages as written. */
  personas: z.custom<PersonasFile>((value) => typeof value === "object").optional(),
  /** The rest of beats.yaml: live writing, persona cards, and decision points. */
  christof: z
    .custom<Pick<BeatsFile, "live" | "cast" | "decide">>((value) => typeof value === "object")
    .optional(),
});

export type StudySettings = z.infer<typeof studySettingsSchema>;
export type StudyDefinition = z.infer<typeof studyDefinitionSchema>;
export type ActorDefinition = z.infer<typeof actorDefinitionSchema>;
export type SpaceDefinition = z.infer<typeof spaceDefinitionSchema>;
export type PostDefinition = z.infer<typeof postDefinitionSchema>;
export type CommentDefinition = z.infer<typeof commentDefinitionSchema>;
export type ReactionDefinition = z.infer<typeof reactionDefinitionSchema>;
export type RemovalDefinition = z.infer<typeof removalDefinitionSchema>;
export type LabelDefinition = z.infer<typeof labelDefinitionSchema>;
export type FlagAnswerDefinition = z.infer<typeof flagAnswerDefinitionSchema>;
export type BanDefinition = z.infer<typeof banDefinitionSchema>;
export type ReportAnswerDefinition = z.infer<typeof reportAnswerDefinitionSchema>;
export type AutoRuleDefinition = z.infer<typeof autoRuleDefinitionSchema>;
export type AppealAnswerDefinition = z.infer<typeof appealAnswerDefinitionSchema>;
export type ContextNoteDefinition = z.infer<typeof contextNoteDefinitionSchema>;
export type StoryDefinition = z.infer<typeof storyDefinitionSchema>;
