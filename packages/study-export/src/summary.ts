/** The fields of an event that summarizing needs. */
export interface SummarizableEvent {
  type: string;
  targetContentId: string | null;
  targetActorId: string | null;
  payload: unknown;
}

export interface DwellLimits {
  /** Views shorter than this don't count toward summaries. Raw values stay in events.csv. */
  minDwellMs?: number | undefined;
  /** Views longer than this don't count toward summaries. */
  maxDwellMs?: number | undefined;
}

export interface ParticipantSummary {
  sessions: number;
  pagesViewed: number;
  activeMs: number;
  postsCreated: number;
  commentsCreated: number;
  /** What's liked or flagged at the end, after any undoing. */
  contentLiked: number;
  contentFlagged: number;
  /** Every click, including ones later undone. */
  likeActions: number;
  flagActions: number;
  actorsFollowed: number;
  actorsBlocked: number;
  actorsReported: number;
  /** Views that fall within the limits. */
  contentViews: number;
  dwellMs: number;
  /** Views outside the limits, so nobody has to guess how many got filtered. */
  viewsExcluded: number;
}

/**
 * Works out a participant's totals from their events. Everything here is a calculation over the
 * record, so changing how it's calculated later doesn't require new data.
 */
export function summarizeEvents(
  events: readonly SummarizableEvent[],
  { minDwellMs = 0, maxDwellMs = Number.POSITIVE_INFINITY }: DwellLimits = {},
): ParticipantSummary {
  const summary: ParticipantSummary = {
    sessions: 0,
    pagesViewed: 0,
    activeMs: 0,
    postsCreated: 0,
    commentsCreated: 0,
    contentLiked: 0,
    contentFlagged: 0,
    likeActions: 0,
    flagActions: 0,
    actorsFollowed: 0,
    actorsBlocked: 0,
    actorsReported: 0,
    contentViews: 0,
    dwellMs: 0,
    viewsExcluded: 0,
  };

  const liked = new Set<string>();
  const flagged = new Set<string>();
  const following = new Set<string>();
  const blocked = new Set<string>();
  const reported = new Set<string>();

  const change = (set: Set<string>, id: string | null, active: boolean) => {
    if (id) {
      if (active) {
        set.add(id);
      } else {
        set.delete(id);
      }
    }
  };

  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    switch (event.type) {
      case "session.started":
        summary.sessions += 1;
        break;
      case "page.viewed":
        summary.pagesViewed += 1;
        break;
      case "session.heartbeat":
        summary.activeMs += Number(payload.activeMs ?? 0);
        break;
      case "content.created":
        if (payload.kind === "post") {
          summary.postsCreated += 1;
        } else {
          summary.commentsCreated += 1;
        }
        break;
      case "content.liked":
        summary.likeActions += 1;
        change(liked, event.targetContentId, true);
        break;
      case "content.unliked":
        change(liked, event.targetContentId, false);
        break;
      case "content.flagged":
        summary.flagActions += 1;
        change(flagged, event.targetContentId, true);
        break;
      case "content.unflagged":
        change(flagged, event.targetContentId, false);
        break;
      case "actor.followed":
        change(following, event.targetActorId, true);
        break;
      case "actor.unfollowed":
        change(following, event.targetActorId, false);
        break;
      case "actor.blocked":
        change(blocked, event.targetActorId, true);
        break;
      case "actor.unblocked":
        change(blocked, event.targetActorId, false);
        break;
      case "actor.reported":
        change(reported, event.targetActorId, true);
        break;
      case "content.viewed": {
        const dwellMs = Number(payload.dwellMs ?? 0);
        if (dwellMs >= minDwellMs && dwellMs <= maxDwellMs) {
          summary.contentViews += 1;
          summary.dwellMs += dwellMs;
        } else {
          summary.viewsExcluded += 1;
        }
        break;
      }
    }
  }

  summary.contentLiked = liked.size;
  summary.contentFlagged = flagged.size;
  summary.actorsFollowed = following.size;
  summary.actorsBlocked = blocked.size;
  summary.actorsReported = reported.size;
  return summary;
}
