import { z } from "zod";

/** Where a team stands on a hosted Truman. A team made on the server is approved. ADR 70. */
export const TEAM_STATUSES = ["pending", "approved", "suspended"] as const;
export type TeamStatus = (typeof TEAM_STATUSES)[number];

/**
 * The most a team may use. Anything left out has no limit. On a hosted Truman, a lab gets
 * HOSTED_STARTING_LIMITS when it's approved, and an operator can change them for that lab.
 */
export const teamLimitsSchema = z.object({
  /** New participants across all its studies in the last 30 days. Test participants don't count. */
  participantsPerMonth: z.number().int().nonnegative().optional(),
  /** Studies open to participants at once. */
  runningStudies: z.number().int().nonnegative().optional(),
  /**
   * How much a lab without its own Claude key may spend on the host's, in US dollars, in all. Left
   * out, the host's key has no limit for it, as for a team made on the server. ADR 71.
   */
  starterBudgetUsd: z.number().nonnegative().max(100_000).optional(),
});
export type TeamLimits = z.infer<typeof teamLimitsSchema>;

export const HOSTED_STARTING_LIMITS: Required<TeamLimits> = {
  participantsPerMonth: 1_000,
  runningStudies: 10,
  starterBudgetUsd: 5,
};

/** What a lab tells a hosted Truman when it applies. */
export const teamApplicationSchema = z.object({
  institution: z.string().trim().min(1).max(200),
  /** What they want to use Truman for, in a few sentences. */
  purpose: z.string().trim().min(1).max(2_000),
  /** Optional: a lab or faculty page, so an operator can see who they are. */
  website: z.string().trim().max(500).optional(),
});
export type TeamApplication = z.infer<typeof teamApplicationSchema>;
