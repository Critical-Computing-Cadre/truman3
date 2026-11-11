import { z } from "zod";

/**
 * Direct messages, between the participant and one person in the cast at a time. See ADR 61.
 */

/** Who a conversation is with. */
export const messagePersonSchema = z.object({
  username: z.string(),
  name: z.string(),
  pictureUrl: z.string().nullable(),
});

export const messageSchema = z.object({
  id: z.string(),
  body: z.string(),
  at: z.iso.datetime(),
  /** The participant wrote it. */
  mine: z.boolean(),
});
export type Message = z.infer<typeof messageSchema>;

/** One conversation on the Messages page: who it's with, the latest message, and how many are new. */
export const conversationSchema = z.object({
  with: messagePersonSchema,
  last: messageSchema,
  /** Messages from them since the participant last opened this conversation. */
  unread: z.number().int().nonnegative(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationsResponseSchema = z.object({
  conversations: z.array(conversationSchema),
});
export type ConversationsResponse = z.infer<typeof conversationsResponseSchema>;

export const threadResponseSchema = z.object({
  with: messagePersonSchema,
  messages: z.array(messageSchema),
});
export type ThreadResponse = z.infer<typeof threadResponseSchema>;
