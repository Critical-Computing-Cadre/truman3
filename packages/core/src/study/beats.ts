import { z } from "zod";
import { parseStudyTime } from "./time.ts";

/**
 * Beats: what Christof, the director, makes happen in each participant's world, and when. A study
 * writes them in `beats.yaml`. A beat has a trigger (`when`), an action (`do`), who it's for
 * (`conditions`), how long after its trigger it happens (`delay`), and limits. Christof decides
 * whether each one happens and when. Later, an actor's model may write the words, but whether
 * something happens stays the study's decision. See ADR 51.
 */

/** hours:minutes, like "0:05" or "-2:00". Kept as text in the file, and as milliseconds here. */
const studyTime = z.string().transform((text, ctx) => {
  const ms = parseStudyTime(text);
  if (ms === null) {
    ctx.addIssue({
      code: "custom",
      message: `"${text}" isn't a time. Use hours:minutes, like 0:05.`,
    });
    return z.NEVER;
  }
  return ms;
});

/** What a participant does that can set a beat off. */
export const PARTICIPANT_ACTIONS = ["post", "comment", "like", "follow", "repost"] as const;

const idSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    "An id can use lowercase letters, numbers, dashes, and underscores.",
  )
  .max(60);

/**
 * When a beat happens: at a set time, when the participant does something, or when another beat
 * does. It's read as one shape, so a mistake in it gets a plain message, and then split by kind.
 */
const triggerSchema = z
  .strictObject({
    /** At a set time, relative to when they start. */
    time: studyTime.optional(),
    /** When the participant does something. */
    participant: z.enum(PARTICIPANT_ACTIONS).optional(),
    /** Only their nth of this, counting from 0. Leave out for any. */
    nth: z.number().int().nonnegative().optional(),
    /** Only if it's on something by this person in the cast, or following them, by username. */
    on: z.string().min(1).optional(),
    /** Only if it's on what a beat made, or anywhere under it, by the beat's id. */
    under: idSchema.optional(),
    /** When another beat happens. */
    beat: idSchema.optional(),
  })
  .superRefine((when, ctx) => {
    const kinds = [when.time, when.participant, when.beat].filter((kind) => kind !== undefined);
    if (kinds.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "Give exactly one of time, participant, or beat.",
      });
    }
    if (
      when.participant === undefined &&
      (when.nth !== undefined || when.on !== undefined || when.under !== undefined)
    ) {
      ctx.addIssue({ code: "custom", message: "nth, on, and under only go with participant." });
    }
  })
  .transform(
    (
      when,
    ):
      | { time: number }
      | {
          participant: (typeof PARTICIPANT_ACTIONS)[number];
          nth?: number;
          on?: string;
          under?: string;
        }
      | { beat: string } => {
      if (when.time !== undefined) {
        return { time: when.time };
      }
      if (when.beat !== undefined) {
        return { beat: when.beat };
      }
      const { participant, nth, on, under } = when;
      return {
        participant: participant as (typeof PARTICIPANT_ACTIONS)[number],
        ...(nth === undefined ? {} : { nth }),
        ...(on === undefined ? {} : { on }),
        ...(under === undefined ? {} : { under }),
      };
    },
  );

/**
 * What an action is done to: what set the beat off, what another beat made, or one of the study's
 * own posts by its id.
 */
const targetSchema = z.union([
  z.literal("trigger"),
  z.strictObject({ beat: idSchema }),
  z.strictObject({ post: z.string().min(1) }),
]);

const actionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("post"),
    actor: z.string().min(1),
    text: z.string().min(1),
  }),
  z.strictObject({
    action: z.literal("comment"),
    actor: z.string().min(1),
    text: z.string().min(1),
    on: targetSchema,
  }),
  z.strictObject({ action: z.literal("like"), actor: z.string().min(1), on: targetSchema }),
  z.strictObject({ action: z.literal("repost"), actor: z.string().min(1), on: targetSchema }),
  /** Following the participant. */
  z.strictObject({ action: z.literal("follow"), actor: z.string().min(1) }),
]);

/** A fixed delay, or a range that each world draws from, the same way every time. */
const delaySchema = z.union([
  studyTime.transform((ms) => ({ minMs: ms, maxMs: ms })),
  z
    .strictObject({ min: studyTime, max: studyTime })
    .transform(({ min, max }) => ({ minMs: min, maxMs: max })),
]);

export const beatSchema = z.strictObject({
  id: idSchema,
  /** A note for the research team. Participants never see it. */
  note: z.string().optional(),
  when: triggerSchema,
  do: actionSchema,
  delay: delaySchema.default({ minMs: 0, maxMs: 0 }),
  /** Leave out for every condition. */
  conditions: z.array(z.string().min(1)).default([]),
  /** How many times it can happen in one world. Most beats happen once. */
  max: z.number().int().positive().default(1),
  /** Not if any of these beats has already happened by the time this one is due. */
  unless: z.array(idSchema).default([]),
});

export const beatsFileSchema = z.strictObject({ beats: z.array(beatSchema).default([]) });

export type BeatDefinition = z.output<typeof beatSchema>;
export type BeatTrigger = BeatDefinition["when"];
export type BeatAction = BeatDefinition["do"];
export type BeatTarget = z.output<typeof targetSchema>;

/** Where a study's beats are, among its pages. They're written by hand, so kept as written. */
export const BEATS_FILE = "beats.yaml";
