import { type Database, schema, type Transaction } from "@truman3/db";
import {
  type ApprovalRules,
  type CompletionCodes,
  completionUrl,
  unmetRules,
} from "@truman3/recruit";
import { eq } from "drizzle-orm";
import { activityOf } from "../admin/prolific.ts";
import type { ParticipantContext } from "../participants/session.ts";

/** The study's link to Prolific. Test participants aren't on Prolific, so they never have one. */
async function linkFor(db: Database | Transaction, participantId: string) {
  const [row] = await db
    .select({
      isPilot: schema.participants.isPilot,
      reviewMode: schema.prolificLinks.reviewMode,
      codes: schema.prolificLinks.codes,
      rules: schema.prolificLinks.rules,
    })
    .from(schema.participants)
    .innerJoin(schema.prolificLinks, eq(schema.prolificLinks.studyId, schema.participants.studyId))
    .where(eq(schema.participants.id, participantId));
  return row && !row.isPilot ? row : null;
}

/**
 * Where to send someone who's finished, when the study doesn't send them to a survey. With
 * automatic approval, the code that pays them straight away only goes to someone who met the rules.
 */
export async function prolificFinishUrl(
  db: Database | Transaction,
  context: ParticipantContext,
): Promise<string | null> {
  const link = await linkFor(db, context.participantId);
  if (!link) {
    return null;
  }
  const codes = link.codes as CompletionCodes;
  if (link.reviewMode === "automatic" && codes.needsReview) {
    const activity = await activityOf(db, [context.participantId]);
    const unmet = unmetRules(
      link.rules as ApprovalRules,
      activity.get(context.participantId) ?? { viewedMs: 0, postsSeen: 0, actions: 0 },
    );
    if (unmet.length > 0) {
      return completionUrl(codes.needsReview);
    }
  }
  return completionUrl(codes.finished);
}

/** Where to send someone who declined, so Prolific asks them to return their submission. */
export async function prolificDeclineUrl(
  db: Database | Transaction,
  context: ParticipantContext,
): Promise<string | null> {
  const link = await linkFor(db, context.participantId);
  return link ? completionUrl((link.codes as CompletionCodes).declined) : null;
}
