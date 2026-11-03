/**
 * What a researcher expects of someone before paying them. Every rule is optional. Failing one only
 * sends someone to be looked at by a person: nothing here rejects anybody.
 */
export interface ApprovalRules {
  minViewMinutes?: number | undefined;
  minPostsSeen?: number | undefined;
  minActions?: number | undefined;
}

/** What someone did, worked out from the events. */
export interface ParticipantActivity {
  viewedMs: number;
  postsSeen: number;
  actions: number;
}

const MINUTE_MS = 60_000;

/** Each rule someone didn't meet, in words a researcher can act on. Empty means they passed. */
export function unmetRules(rules: ApprovalRules, activity: ParticipantActivity): string[] {
  const unmet: string[] = [];
  if (rules.minViewMinutes !== undefined && activity.viewedMs < rules.minViewMinutes * MINUTE_MS) {
    unmet.push(
      `Viewed posts for ${(activity.viewedMs / MINUTE_MS).toFixed(1)} of ${rules.minViewMinutes} minutes`,
    );
  }
  if (rules.minPostsSeen !== undefined && activity.postsSeen < rules.minPostsSeen) {
    unmet.push(`Saw ${activity.postsSeen} of ${rules.minPostsSeen} posts`);
  }
  if (rules.minActions !== undefined && activity.actions < rules.minActions) {
    unmet.push(`Did ${activity.actions} of ${rules.minActions} actions`);
  }
  return unmet;
}
