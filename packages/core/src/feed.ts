import { z } from "zod";
import { COMMENT_SORTS, FEED_SORTS } from "./orders.ts";
import { POST_TAGS } from "./post-extras.ts";

/** A flair label, as drawn. */
const feedFlairSchema = z.object({ text: z.string(), color: z.string().optional() });

export const feedAuthorSchema = z.object({
  username: z.string(),
  name: z.string(),
  pictureUrl: z.string().nullable(),
  /** The viewer's own account, which links to their own page rather than a profile. */
  isViewer: z.boolean(),
  /** Marked as a moderator in the study. Only ever true, so it's absent for everyone else. */
  moderator: z.literal(true).optional(),
  /** Their points, on a platform with karma. */
  karma: z.number().optional(),
  /** Their flair in the community this post is in. */
  flair: feedFlairSchema.optional(),
});

/** How deep a thread can go. It keeps deep threads readable on a phone, and the work bounded. */
export const MAX_REPLY_DEPTH = 16;

export const feedCommentSchema = z.object({
  id: z.string(),
  /** How many replies down this is. 0 is directly on the post. Always 0 without threads. */
  depth: z.number().int().nonnegative(),
  author: feedAuthorSchema,
  body: z.string(),
  at: z.iso.datetime(),
  likes: z.number(),
  liked: z.boolean(),
  ups: z.number(),
  downs: z.number(),
  /** How this viewer voted. */
  vote: z.enum(["up", "down"]).nullable(),
  flagged: z.boolean(),
});

/** The most photos one post can have. */
export const MAX_ATTACHMENTS = 10;

/** A file on a post. Each has a type, so other kinds, such as video, can join images. */
export const attachmentSchema = z.object({ type: z.enum(["image"]), key: z.string() });
export type Attachment = z.infer<typeof attachmentSchema>;

export const feedAttachmentSchema = z.object({ type: z.enum(["image"]), url: z.string() });
export type FeedAttachment = z.infer<typeof feedAttachmentSchema>;

/**
 * A poll, as this viewer may see it. The counts only reach a browser if they're allowed to see them
 * now, so hiding results before someone votes can't be got around by reading the response.
 */
export const feedPollSchema = z.object({
  options: z.array(z.object({ text: z.string(), votes: z.number().optional() })),
  /** The option this viewer chose, by its place in the list. */
  voted: z.number().nullable(),
});
export type FeedPoll = z.infer<typeof feedPollSchema>;

/** What a crosspost shows of the post it came from. */
export const feedOriginalSchema = z.object({
  id: z.string(),
  authorName: z.string(),
  title: z.string().optional(),
  body: z.string(),
  imageUrl: z.string().optional(),
  linkDomain: z.string().optional(),
  space: z.object({ key: z.string(), name: z.string() }).optional(),
});
export type FeedOriginal = z.infer<typeof feedOriginalSchema>;

export const feedPostSchema = z.object({
  id: z.string(),
  author: feedAuthorSchema,
  /** Its title, on a platform with titles. */
  title: z.string().optional(),
  body: z.string(),
  attachments: z.array(feedAttachmentSchema),
  /** Where it links to, on a platform with link posts. */
  link: z.object({ url: z.string(), domain: z.string() }).optional(),
  /** Its poll, on a platform with polls. */
  poll: feedPollSchema.optional(),
  /** Its label in its community, on a platform with flair. */
  flair: feedFlairSchema.optional(),
  /** On a crosspost, the post it came from. Null if this viewer can't see that post. */
  crosspost: z.object({ original: feedOriginalSchema.nullable() }).optional(),
  /** Kept on top of this list by the study. Only ever true. */
  pinned: z.literal(true).optional(),
  /** Nobody can comment on it. Only ever true. */
  locked: z.literal(true).optional(),
  /** Why it's covered until someone clicks it. Left out if it isn't. */
  tags: z.array(z.enum(POST_TAGS)).optional(),
  /** This viewer saved it. Only ever true. */
  saved: z.literal(true).optional(),
  /** This viewer hid it. It only reaches them on their list of hidden posts, or its own page. */
  hidden: z.literal(true).optional(),
  /** The space it belongs to, on a platform with spaces. */
  space: z
    .object({ key: z.string(), name: z.string(), pictureUrl: z.string().optional() })
    .optional(),
  at: z.iso.datetime(),
  likes: z.number(),
  liked: z.boolean(),
  ups: z.number(),
  downs: z.number(),
  /** How this viewer voted. */
  vote: z.enum(["up", "down"]).nullable(),
  flagged: z.boolean(),
  comments: z.array(feedCommentSchema),
  /** How many comments it has, even in a list that leaves them for the post's own page. */
  commentCount: z.number(),
});

export const feedResponseSchema = z.object({
  posts: z.array(feedPostSchema),
  /** The order this person chose for this list, where a study lets them. Null is the study's. */
  sort: z.enum(FEED_SORTS).nullable().optional(),
  /** The order this person chose for comments, where a study lets them. Null is the study's. */
  commentSort: z.enum(COMMENT_SORTS).nullable().optional(),
});

/** A space, as a participant sees it. */
export const spaceViewSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  rules: z.string().nullable(),
  pictureUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  /** A color from the study, as #rrggbb. Draw it with `textOnAccent` for what goes on top. */
  accent: z.string().nullable(),
  /** How many members it says it has. Null if the study didn't write a number, so none is shown. */
  memberCount: z.number().nullable(),
  joined: z.boolean(),
  /** What posts in it can be labeled with. Empty on a platform without flair. */
  postFlair: z.array(feedFlairSchema),
  /** What people in it can show beside their name. Empty on a platform without flair. */
  userFlair: z.array(feedFlairSchema),
  /** Whether a post someone writes here has to have flair. */
  requirePostFlair: z.boolean(),
  /** The flair this person chose here. */
  myFlair: z.string().nullable(),
});
export type SpaceView = z.infer<typeof spaceViewSchema>;

export type FeedAuthor = z.infer<typeof feedAuthorSchema>;
export type FeedComment = z.infer<typeof feedCommentSchema>;
export type FeedPost = z.infer<typeof feedPostSchema>;
export type FeedResponse = z.infer<typeof feedResponseSchema>;
