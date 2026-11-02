const STUDY_TIME = /^(-?)(\d+):([0-5]\d)(?::([0-5]\d))?$/;

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Converts a study time like "2:05" or "-20:35" (hours:minutes, optionally :seconds) to
 * milliseconds relative to when a participant starts. Negative times are before they arrived.
 * Returns null if the text isn't a valid time.
 */
export function parseStudyTime(text: string): number | null {
  const match = STUDY_TIME.exec(text.trim());
  if (!match) {
    return null;
  }

  const [, sign, hours, minutes, seconds] = match;
  const magnitude =
    Number(hours) * HOUR_MS + Number(minutes) * MINUTE_MS + Number(seconds ?? 0) * SECOND_MS;
  return sign === "-" && magnitude !== 0 ? -magnitude : magnitude;
}

/** The reverse of parseStudyTime: milliseconds back to hours and minutes, like "-20:35". */
export function formatStudyTime(ms: number): string {
  const totalMinutes = Math.round(Math.abs(ms) / MINUTE_MS);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${ms < 0 && totalMinutes > 0 ? "-" : ""}${hours}:${minutes}`;
}

export { HOUR_MS };
