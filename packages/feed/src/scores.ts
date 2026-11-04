/**
 * The arithmetic behind the orders forums tend to have. These are ours, chosen to behave sensibly and
 * to be easy to report in a methods section. They aren't any real platform's formulas (ADR 28). The
 * codebook says the same things in words, so a change here means changing it there, and a new version.
 */

const HOUR_MS = 60 * 60 * 1000;

const ageHours = (timeMs: number, nowMs: number) => Math.max(0, nowMs - timeMs) / HOUR_MS;

/**
 * The lower bound of the Wilson score interval at 95% for the share of up votes. It stays cautious
 * about few votes, so 3 up and none down doesn't beat 300 up and 10 down.
 */
export function bestScore(ups: number, downs: number): number {
  const total = ups + downs;
  if (total === 0) {
    return 0;
  }
  const z = 1.96;
  const share = ups / total;
  const z2 = z * z;
  return (
    (share + z2 / (2 * total) - z * Math.sqrt((share * (1 - share) + z2 / (4 * total)) / total)) /
    (1 + z2 / total)
  );
}

/** All votes, times how evenly they split. Nothing is controversial if everyone agrees. */
export function controversyScore(ups: number, downs: number): number {
  if (ups === 0 || downs === 0) {
    return 0;
  }
  return (ups + downs) * (Math.min(ups, downs) / Math.max(ups, downs));
}

/** Score, divided by age in hours plus 2, to the power of 1.5, so posts fall as they get older. */
export function hotScore(score: number, timeMs: number, nowMs: number): number {
  return score / (ageHours(timeMs, nowMs) + 2) ** 1.5;
}

/** Score per hour, counting from one hour old. */
export function risingScore(score: number, timeMs: number, nowMs: number): number {
  return score / (ageHours(timeMs, nowMs) + 1);
}

/** How long a post counts as recent, for the rising order. */
export const RISING_WINDOW_MS = 24 * HOUR_MS;
