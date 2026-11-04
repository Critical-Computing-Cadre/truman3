import { z } from "zod";
import { ACCENT_PATTERN } from "./color.ts";

export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 6;
export const MAX_POLL_OPTION_LENGTH = 120;

/** A poll on a post. An option is known by its place in the list, which can't change once frozen. */
export const pollSchema = z.strictObject({
  options: z
    .array(
      z.strictObject({
        text: z.string().trim().min(1).max(MAX_POLL_OPTION_LENGTH),
        /** The votes it starts with, which the study sets. */
        votes: z.number().int().nonnegative().default(0),
      }),
    )
    .min(MIN_POLL_OPTIONS)
    .max(MAX_POLL_OPTIONS),
  /** Whether someone sees the counts before voting. Leave out for after. */
  resultsFirst: z.boolean().default(false),
});
export type Poll = z.infer<typeof pollSchema>;

/** Why a list of options can't be a poll, or null if it can. For what a participant writes. */
export function pollOptionsProblem(options: readonly string[]): string | null {
  if (options.length < MIN_POLL_OPTIONS || options.length > MAX_POLL_OPTIONS) {
    return `A poll needs ${MIN_POLL_OPTIONS} to ${MAX_POLL_OPTIONS} options.`;
  }
  if (options.some((option) => option.length > MAX_POLL_OPTION_LENGTH)) {
    return `A poll option can be up to ${MAX_POLL_OPTION_LENGTH} characters.`;
  }
  if (new Set(options.map((option) => option.toLowerCase())).size < options.length) {
    return "A poll's options have to be different from each other.";
  }
  return null;
}

export const MAX_FLAIR_LENGTH = 40;

/** A label a study offers in a space. Its text is what posts and people refer to it by. */
export const flairSchema = z.strictObject({
  text: z.string().trim().min(1).max(MAX_FLAIR_LENGTH),
  /** Its color, as #rrggbb. Any color works, since the text on it is chosen to be readable. */
  color: z.string().regex(ACCENT_PATTERN, "Use a color like #1d4ed8.").optional(),
});
export type Flair = z.infer<typeof flairSchema>;
