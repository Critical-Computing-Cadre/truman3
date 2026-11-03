import { z } from "zod";

export const feedAuthorSchema = z.object({
  username: z.string(),
  name: z.string(),
  pictureUrl: z.string().nullable(),
  /** The viewer's own account, which links to their own page rather than a profile. */
  isViewer: z.boolean(),
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
  flagged: z.boolean(),
});

export const feedPostSchema = z.object({
  id: z.string(),
  author: feedAuthorSchema,
  body: z.string(),
  imageUrl: z.string().nullable(),
  at: z.iso.datetime(),
  likes: z.number(),
  liked: z.boolean(),
  flagged: z.boolean(),
  comments: z.array(feedCommentSchema),
});

export const feedResponseSchema = z.object({ posts: z.array(feedPostSchema) });

export type FeedAuthor = z.infer<typeof feedAuthorSchema>;
export type FeedComment = z.infer<typeof feedCommentSchema>;
export type FeedPost = z.infer<typeof feedPostSchema>;
export type FeedResponse = z.infer<typeof feedResponseSchema>;
