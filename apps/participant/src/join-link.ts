/**
 * Finds the join page in something a participant pasted: a study's whole link, the app's own kind
 * of link (commons://join/…), or just the part from /join/ on. Gives back the path on this site,
 * with its recruitment ID if it had one, or null when it isn't a study link. Only ever a path under
 * /join/, so pasting can't send anyone to another site.
 */
export function joinPathFrom(pasted: string): string | null {
  const text = pasted.trim();
  const found = /(?:^|\/)join\/([A-Za-z0-9][A-Za-z0-9_-]*)\/?(\?[^\s#]*)?/.exec(text);
  if (!found || /\s/.test(text)) {
    return null;
  }
  return `/join/${found[1]}${found[2] ?? ""}`;
}
