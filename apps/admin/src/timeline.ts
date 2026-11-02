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
