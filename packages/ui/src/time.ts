const UNITS: [number, string][] = [
  [86_400, "d"],
  [3_600, "h"],
  [60, "m"],
];

/** A short time like social media shows: "3h", "2d", or "now". */
export function shortTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  for (const [size, label] of UNITS) {
    if (seconds >= size) {
      return `${Math.floor(seconds / size)}${label}`;
    }
  }
  return "now";
}
