import { z } from "zod";
import { eventPayloadSchemas } from "../events.ts";
import { parseStudyTime } from "./time.ts";

/**
 * Beats: what Christof, the director, makes happen in each participant's world, and when. A study
 * writes them in `beats.yaml`. A beat has a trigger (`when`), an action (`do`), who it's for
 * (`conditions`), how long after its trigger it happens (`delay`), and limits. Christof decides
 * whether each one happens and when. Later, an actor's model may write the words, but whether
 * something happens stays the study's decision. See ADR 51.
 */

/** hours:minutes, like "0:05" or "-2:00". Kept as text in the file, and as milliseconds here. */
export const studyTime = z.string().transform((text, ctx) => {
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
export const PARTICIPANT_ACTIONS = [
  "post",
  "comment",
  "like",
  "follow",
  "repost",
  "message",
] as const;

export const idSchema = z
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
    /** Only if it's on something by this person in the cast, following them, or messaging them, by username. */
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

/**
 * What's said: fixed `text`, or `improvise`, which tells the actor's model what to write, with a
 * `fallback` line for when live writing is off, out of budget, paused, or fails its check.
 */
const wording = {
  text: z.string().min(1).optional(),
  improvise: z.string().min(1).max(1000).optional(),
  fallback: z.string().min(1).optional(),
  /**
   * Rehearsed lines for an improvised beat: written before launch, reviewed, and frozen with the
   * version. `live.stray` says whether a model may write something else.
   */
  lines: z.array(z.string().min(1).max(5000)).max(50).optional(),
};
const checkWording = (
  action: {
    text?: string | undefined;
    improvise?: string | undefined;
    fallback?: string | undefined;
    lines?: string[] | undefined;
  },
  ctx: z.RefinementCtx,
) => {
  if (action.lines !== undefined && action.improvise === undefined) {
    ctx.addIssue({ code: "custom", message: "Rehearsed lines only go with improvise." });
  }
  if ((action.text === undefined) === (action.improvise === undefined)) {
    ctx.addIssue({ code: "custom", message: "Give either text or improvise." });
  }
  if (action.improvise !== undefined && action.fallback === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "An improvised line needs a fallback line, for when live writing can't be used.",
    });
  }
  if (action.text !== undefined && action.fallback !== undefined) {
    ctx.addIssue({ code: "custom", message: "A fallback only goes with improvise." });
  }
};

const actionSchema = z.discriminatedUnion("action", [
  z
    .strictObject({ action: z.literal("post"), actor: z.string().min(1), ...wording })
    .superRefine(checkWording),
  z
    .strictObject({
      action: z.literal("comment"),
      actor: z.string().min(1),
      ...wording,
      on: targetSchema,
    })
    .superRefine(checkWording),
  z.strictObject({ action: z.literal("like"), actor: z.string().min(1), on: targetSchema }),
  z.strictObject({ action: z.literal("repost"), actor: z.string().min(1), on: targetSchema }),
  /** Following the participant. */
  z.strictObject({ action: z.literal("follow"), actor: z.string().min(1) }),
  /** A direct message to the participant. */
  z
    .strictObject({ action: z.literal("message"), actor: z.string().min(1), ...wording })
    .superRefine(checkWording),
  /** A moderator takes something down, with the reason they give. */
  z.strictObject({
    action: z.literal("remove"),
    actor: z.string().min(1),
    on: targetSchema,
    reason: z.string().min(1).max(500).optional(),
  }),
  /** A moderator labels something, such as "Misleading". */
  z.strictObject({
    action: z.literal("label"),
    actor: z.string().min(1),
    on: targetSchema,
    label: z.string().min(1).max(40),
  }),
  /** A moderator warns the participant about something they wrote. */
  z.strictObject({
    action: z.literal("warn"),
    actor: z.string().min(1),
    on: targetSchema,
    warning: z.string().min(1).max(500),
  }),
  /** A moderator bans someone in the cast, from everywhere, by username. */
  z.strictObject({
    action: z.literal("ban"),
    actor: z.string().min(1),
    who: z.string().min(1),
    reason: z.string().min(1).max(500).optional(),
  }),
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
  /**
   * Whether a researcher approves it before it happens, as in a Wizard of Oz study. Leave out to
   * follow the study's `live.approval`.
   */
  approve: z.boolean().optional(),
});

/**
 * Who someone in the cast is, for when their model writes for them. Everything is optional, and
 * what's given goes into what the model is told. Red lines are things they never do.
 */
export const personaSchema = z.strictObject({
  about: z.string().max(2000).optional(),
  voice: z.string().max(1000).optional(),
  values: z.string().max(1000).optional(),
  goals: z.string().max(1000).optional(),
  /** How they feel about others in the cast, and the participant, by username or "participant". */
  relationships: z.record(z.string(), z.string().max(500)).optional(),
  redLines: z.array(z.string().min(1).max(500)).default([]),
});

/** Whether the actors' models write live, and within what. Off unless a study turns it on. */
export const liveWritingSchema = z.strictObject({
  enabled: z.boolean().default(false),
  /** The most this study can spend on writing, in US dollars, across everyone in it. */
  budgetUsd: z.number().positive().max(10_000).default(5),
  model: z.string().min(1).default("claude-opus-5-5"),
  /** The longest anything written can be, in characters. */
  maxLength: z.number().int().positive().max(5000).default(500),
  /** Things nobody in the cast ever writes, on top of each person's own red lines. */
  redLines: z.array(z.string().min(1).max(500)).default([]),
  /**
   * Which beats wait for a researcher to approve, edit, or skip them: none, or all. A beat can say
   * otherwise with `approve`. It works with live writing off too, so a researcher writes the line.
   */
  approval: z.enum(["none", "all"]).default("none"),
  /**
   * How long a beat waits for a researcher before its fallback or fixed line is used instead, so
   * nobody waits forever. "never" waits as long as it takes. Ten minutes unless a study says.
   */
  approvalTimeout: z
    .union([z.literal("never").transform(() => null), studyTime])
    .default(10 * 60_000),
  /**
   * For beats with rehearsed lines, how far a model may stray from them: never (it picks one),
   * choose (it picks one, or writes its own if none fits), or always (it writes its own every time).
   */
  stray: z.enum(["never", "choose", "always"]).default("choose"),
});

/**
 * What a decision point can count, by a short name, and the event it counts. Anything else in the
 * event log can be counted by its event type, like `content.opened`.
 */
export const COUNTABLE = {
  post: { type: "content.created", kind: "post" },
  comment: { type: "content.created", kind: "comment" },
  like: { type: "content.liked" },
  repost: { type: "content.reposted" },
  follow: { type: "actor.followed" },
  flag: { type: "content.flagged" },
} as const satisfies Record<string, { type: keyof typeof eventPayloadSchemas; kind?: string }>;

/**
 * A tailoring variable: something about the participant, measured from the event log as of the
 * decision. Each is a number, so a rule can compare it.
 */
const measureSchema = z.union([
  /** How many times they did something, in the whole study or `within` the time before. */
  z.strictObject({
    count: z
      .string()
      .min(1)
      .refine((what) => what in COUNTABLE || what in eventPayloadSchemas, {
        message: `Count one of ${Object.keys(COUNTABLE).join(", ")}, or an event type like content.opened.`,
      }),
    within: studyTime.optional(),
  }),
  /** How many minutes they were active on the site. */
  z.strictObject({ activeMinutes: z.literal(true), within: studyTime.optional() }),
  /** 1 if a beat has happened for them, or 0. */
  z.strictObject({ fired: idSchema }),
]);

/** A test of one measure. Both ends are included. */
const boundsSchema = z
  .strictObject({ atLeast: z.number().optional(), atMost: z.number().optional() })
  .refine(({ atLeast, atMost }) => atLeast !== undefined || atMost !== undefined, {
    message: "Give atLeast, atMost, or both.",
  });

/**
 * A group at a decision point: who's in it, by their measures, and what happens to them. They're
 * re-randomized among conditions by weight, or `stay` where they are.
 */
const groupSchema = z.strictObject({
  name: idSchema,
  /** Every test has to pass. Leave out for everyone not in an earlier group. */
  if: z.record(z.string(), boundsSchema).default({}),
  to: z.union([z.literal("stay"), z.record(z.string(), z.number().int().positive())]),
});

/**
 * A decision point, as in a SMART design or a just-in-time adaptive intervention: when it's
 * reached, the participant's measures are taken, the first group they fit decides their next
 * condition, and the choice is recorded in `assignments` with its probability. See ADR 55.
 */
export const decisionSchema = z.strictObject({
  id: idSchema,
  /** A note for the research team. Participants never see it. */
  note: z.string().optional(),
  when: triggerSchema,
  /** Who it's for, by their condition when it's reached. Leave out for everyone. */
  conditions: z.array(z.string().min(1)).default([]),
  measure: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), measureSchema).default({}),
  /** In order. Someone in no group stays where they are. */
  groups: z.array(groupSchema).min(1, "Give at least one group."),
});

export const beatsFileSchema = z.strictObject({
  live: liveWritingSchema.default({
    enabled: false,
    budgetUsd: 5,
    model: "claude-opus-5-5",
    maxLength: 500,
    redLines: [],
    approval: "none",
    approvalTimeout: 10 * 60_000,
    stray: "choose",
  }),
  /** Persona cards, by username. */
  cast: z.record(z.string(), personaSchema).default({}),
  beats: z.array(beatSchema).default([]),
  /** Decision points for adaptive designs. */
  decide: z.array(decisionSchema).default([]),
});

export type Persona = z.output<typeof personaSchema>;
export type LiveWriting = z.output<typeof liveWritingSchema>;
export type BeatsFile = z.output<typeof beatsFileSchema>;
export type DecisionDefinition = z.output<typeof decisionSchema>;
export type Measure = z.output<typeof measureSchema>;

export type BeatDefinition = z.output<typeof beatSchema>;
export type BeatTrigger = BeatDefinition["when"];
export type BeatAction = BeatDefinition["do"];
export type BeatTarget = z.output<typeof targetSchema>;

/** Where a study's beats are, among its pages. They're written by hand, so kept as written. */
export const BEATS_FILE = "beats.yaml";
