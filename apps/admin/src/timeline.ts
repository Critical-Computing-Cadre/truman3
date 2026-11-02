export interface TimelinePost {
  offsetMs: number;
  conditions: string[];
}

const HOUR_MS = 3_600_000;
/** Enough bars to read the feed's pace, without being too thin to see. */
const MAX_BARS = 96;

const appliesTo = (post: TimelinePost, condition: string) =>
  post.conditions.length === 0 || post.conditions.includes(condition);

/** How many posts start appearing in each stretch of a study, in this condition. */
export function postsPerBar(posts: readonly TimelinePost[], condition: string, lengthMs: number) {
  const barMs = Math.max(HOUR_MS, Math.ceil(lengthMs / MAX_BARS / HOUR_MS) * HOUR_MS);
  const counts = Array.from({ length: Math.ceil(lengthMs / barMs) }, () => 0);

  for (const post of posts) {
    if (appliesTo(post, condition) && post.offsetMs >= 0 && post.offsetMs < lengthMs) {
      const index = Math.floor(post.offsetMs / barMs);
      counts[index] = (counts[index] ?? 0) + 1;
    }
  }
  return { counts, barMs };
}

/** Posts that no one in this condition can ever see, which is otherwise hard to notice. */
export function postsThatNeverAppear(
  posts: readonly TimelinePost[],
  condition: string,
  lengthMs: number,
  windowHours: number | null,
) {
  return posts.filter(
    (post) =>
      appliesTo(post, condition) &&
      (post.offsetMs >= lengthMs ||
        (windowHours !== null && post.offsetMs < -windowHours * HOUR_MS)),
  ).length;
}

/** A point in a study, as a researcher would say it: "Day 2, 6 hours in". */
export function describeTime(elapsedMs: number): string {
  const totalHours = elapsedMs / HOUR_MS;
  const day = Math.floor(totalHours / 24) + 1;
  const hours = totalHours % 24;
  const minutes = Math.round((hours - Math.floor(hours)) * 60);
  const clock = minutes > 0 ? `${Math.floor(hours)}h ${minutes}m` : `${Math.floor(hours)}h`;
  return `Day ${day}, ${clock} in`;
}

const SNAP_MS = 5 * 60_000;
/** About as wide as a marker, compared with the whole line, so they stack instead of overlapping. */
const MARKER_FRACTION = 0.009;
const MAX_ROWS = 10;

export interface TimelineRange {
  startMs: number;
  endMs: number;
}

/** The span to draw: the whole study, plus any posts outside it, so they can be dragged back in. */
export function timelineRange(
  posts: readonly { offsetMs: number }[],
  lengthMs: number,
  windowHours: number | null,
): TimelineRange {
  const offsets = posts.map(({ offsetMs }) => offsetMs);
  const startMs = Math.min(0, windowHours === null ? 0 : -windowHours * HOUR_MS, ...offsets);
  const endMs = Math.max(lengthMs, ...offsets);
  return { startMs, endMs: endMs > startMs ? endMs : startMs + HOUR_MS };
}

/** The time at a point along the line, from 0 to 1, rounded so posts land on tidy times. */
export function timeAtFraction(fraction: number, { startMs, endMs }: TimelineRange): number {
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round((startMs + clamped * (endMs - startMs)) / SNAP_MS) * SNAP_MS;
}

/** Whether a post can ever be seen. */
export function postPlacement(
  offsetMs: number,
  lengthMs: number,
  windowHours: number | null,
): "ok" | "early" | "late" {
  if (offsetMs >= lengthMs) {
    return "late";
  }
  if (windowHours !== null && offsetMs < -windowHours * HOUR_MS) {
    return "early";
  }
  return "ok";
}

/** Where each post goes on the line. Posts at nearly the same time stack, so all can be grabbed. */
export function layoutMarkers(
  posts: readonly { id: string; offsetMs: number }[],
  { startMs, endMs }: TimelineRange,
): { id: string; left: number; row: number }[] {
  const span = endMs - startMs;
  const rowEnds = Array.from({ length: MAX_ROWS }, () => Number.NEGATIVE_INFINITY);

  return [...posts]
    .sort((a, b) => a.offsetMs - b.offsetMs || a.id.localeCompare(b.id))
    .map(({ id, offsetMs }) => {
      const fraction = (offsetMs - startMs) / span;
      const free = rowEnds.findIndex((end) => end <= fraction);
      const row = free === -1 ? MAX_ROWS - 1 : free;
      rowEnds[row] = fraction + MARKER_FRACTION;
      return { id, left: fraction * 100, row };
    });
}

/** When a post appears, in words. */
export function describeOffset(offsetMs: number): string {
  if (offsetMs < 0) {
    const hours = Math.floor(-offsetMs / HOUR_MS);
    const minutes = Math.round((-offsetMs % HOUR_MS) / 60_000);
    return `${hours}h ${minutes}m before they start`;
  }
  return describeTime(offsetMs);
}
