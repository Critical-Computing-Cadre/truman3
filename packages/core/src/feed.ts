import { z } from "zod";
import { COMMENT_SORTS, FEED_SORTS } from "./orders.ts";

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

export const feedPostSchema = z.object({
  id: z.string(),
  author: feedAuthorSchema,
  /** Its title, on a platform with titles. */
  title: z.string().optional(),
  body: z.string(),
  attachments: z.array(feedAttachmentSchema),
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
});
export type SpaceView = z.infer<typeof spaceViewSchema>;

export type FeedAuthor = z.infer<typeof feedAuthorSchema>;
export type FeedComment = z.infer<typeof feedCommentSchema>;
export type FeedPost = z.infer<typeof feedPostSchema>;
export type FeedResponse = z.infer<typeof feedResponseSchema>;
