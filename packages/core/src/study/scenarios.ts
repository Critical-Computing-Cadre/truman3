import { z } from "zod";
import { idSchema, studyTime } from "./beats.ts";

/**
 * Scenario tests: a made-up participant does set things at set times, in a world fast-forwarded
 * through the study, and the study says what should have happened by then. They're written in
 * `scenarios.yaml` and run with `pnpm study test`. Nobody real takes part. See ADR 56.
 */
export const SCENARIOS_FILE = "scenarios.yaml";

/**
 * One of the study's posts or comments, by its id, what a beat made in this world, or, with several
 * participants, the latest post one of them wrote.
 */
const targetSchema = z.union([
  z.strictObject({ post: z.string().min(1) }),
  z.strictObject({ comment: z.string().min(1) }),
  z.strictObject({ beat: idSchema }),
  z.strictObject({ participant: idSchema }),
]);

/** What should be true at a step. Every part is optional. */
const expectSchema = z.strictObject({
  /** Beats or decision points that have happened by now. */
  happened: z.array(idSchema).default([]),
  /** Beats or decision points that haven't. */
  notHappened: z.array(idSchema).default([]),
  /** The condition they're in now. */
  condition: z.string().min(1).optional(),
  /** Text in their feed, in a post, a comment, or a moderator's label, or in their messages. */
  sees: z.array(z.string().min(1)).default([]),
  doesNotSee: z.array(z.string().min(1)).default([]),
});

const ACTIONS = [
  "post",
  "comment",
  "like",
  "repost",
  "flag",
  "follow",
  "message",
  "expect",
] as const;

const stepSchema = z
  .strictObject({
    /** When, from when they start, like "0:05". */
    at: studyTime,
    /** With several participants, who does this, or whose view is checked. The first by default. */
    as: idSchema.optional(),
    /** They write a post with this text. */
    post: z.string().min(1).optional(),
    /** They comment with this text, on what `on` says. */
    comment: z.string().min(1).optional(),
    on: targetSchema.optional(),
    like: targetSchema.optional(),
    repost: targetSchema.optional(),
    /** They flag it. */
    flag: targetSchema.optional(),
    /** They follow someone in the cast, by username, or another participant, by name. */
    follow: z.string().min(1).optional(),
    /** They send a direct message with this text, to who `to` says, by username. */
    message: z.string().min(1).optional(),
    to: z.string().min(1).optional(),
    expect: expectSchema.optional(),
  })
  .superRefine((step, ctx) => {
    const kinds = ACTIONS.filter((kind) => step[kind] !== undefined);
    if (kinds.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: `Give exactly one of ${ACTIONS.join(", ")} in a step.`,
      });
    }
    if ((step.comment !== undefined) !== (step.on !== undefined)) {
      ctx.addIssue({ code: "custom", message: "A comment needs on, and only a comment has it." });
    }
    if ((step.message !== undefined) !== (step.to !== undefined)) {
      ctx.addIssue({ code: "custom", message: "A message needs to, and only a message has it." });
    }
  });

export const scenarioSchema = z.strictObject({
  name: z.string().min(1),
  /** The condition they start in. */
  condition: z.string().min(1),
  /**
   * Names for several made-up participants, who share one world and see each other (ADR 68).
   * Leave out for one participant.
   */
  participants: z
    .array(idSchema)
    .min(2, "Name at least two participants, or leave this out.")
    .optional(),
  steps: z.array(stepSchema).min(1, "Give at least one step."),
});

export const scenariosFileSchema = z.strictObject({
  scenarios: z.array(scenarioSchema).default([]),
});

export type Scenario = z.output<typeof scenarioSchema>;
export type ScenarioStep = Scenario["steps"][number];
export type ScenarioTarget = z.output<typeof targetSchema>;
