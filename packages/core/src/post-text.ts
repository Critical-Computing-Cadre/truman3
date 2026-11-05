export type TextPiece =
  | { type: "text"; text: string }
  | { type: "tag"; text: string; tag: string }
  | { type: "mention"; text: string; username: string };

const PIECES = /(^|[^\p{L}\p{N}_#@])(#[\p{L}\p{N}_]+|@[A-Za-z0-9_][A-Za-z0-9_.-]*)/gu;

/** Splits what someone wrote into plain text, hashtags, and mentions, on a platform that has them. */
export function textPieces(
  text: string,
  on: { hashtags: boolean; mentions: boolean },
): TextPiece[] {
  const pieces: TextPiece[] = [];
  let last = 0;
  for (const match of text.matchAll(PIECES)) {
    const [, before = "", found = ""] = match;
    const isTag = found.startsWith("#");
    if ((isTag && !on.hashtags) || (!isTag && !on.mentions)) {
      continue;
    }
    const start = match.index + before.length;
    if (start > last) {
      pieces.push({ type: "text", text: text.slice(last, start) });
    }
    pieces.push(
      isTag
        ? { type: "tag", text: found, tag: found.slice(1).toLowerCase() }
        : // A sentence can end right after a mention, and that full stop isn't part of it.
          {
            type: "mention",
            text: found.replace(/[.-]+$/, ""),
            username: found.slice(1).replace(/[.-]+$/, ""),
          },
    );
    last = start + found.replace(/[.-]+$/, "").length;
  }
  if (last < text.length) {
    pieces.push({ type: "text", text: text.slice(last) });
  }
  return pieces;
}

/** Whether what someone wrote has this hashtag, ignoring case. */
export function hasHashtag(text: string, tag: string): boolean {
  const wanted = tag.replace(/^#/, "").toLowerCase();
  return textPieces(text, { hashtags: true, mentions: false }).some(
    (piece) => piece.type === "tag" && piece.tag === wanted,
  );
}
