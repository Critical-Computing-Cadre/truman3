/**
 * Whether a copy restored from a backup has what the live database has (ADR 73, and
 * docs/guides/restoring.md). It compares how many rows the main tables have in each, and gives a
 * verdict, so checking a restore doesn't depend on someone reading two lists of numbers in a log.
 *
 * A backup is from a few minutes ago, and the live database carries on while the copy is being
 * made, so the copy is expected to be a little behind. Rows are also deleted now and then:
 * someone withdraws, a demo visit ages out. So "the same" is too strict either way. What this
 * catches is a copy that's empty, or missing a large part of a table.
 */

export type Counts = Record<string, number>;

export interface Comparison {
  ok: boolean;
  lines: string[];
}

/** A table this small can differ by a few rows and still be far apart as a share. */
const SMALL = 20;
/** The copy may be this far behind before it's called a problem. */
const SHARE = 0.8;

export function compareCounts(live: Counts, copy: Counts): Comparison {
  const lines: string[] = [];
  let ok = true;
  for (const [table, inLive] of Object.entries(live)) {
    const inCopy = copy[table];
    let verdict = "ok";
    if (inCopy === undefined) {
      verdict = "MISSING from the copy";
    } else if (inLive > 0 && inCopy === 0) {
      verdict = "EMPTY in the copy";
    } else if (inLive - inCopy > SMALL && inCopy < inLive * SHARE) {
      verdict = "FAR FEWER in the copy";
    } else if (inCopy - inLive > SMALL && inLive < inCopy * SHARE) {
      // Not a failed backup, but worth knowing: a lot was deleted while the copy was made.
      verdict = "ok, though the live database has far fewer";
    }
    if (verdict !== "ok" && !verdict.startsWith("ok,")) {
      ok = false;
    }
    lines.push(
      `${table.padEnd(13)} live ${String(inLive).padStart(9)}   copy ${String(inCopy ?? "-").padStart(9)}   ${verdict}`,
    );
  }
  lines.push(
    ok
      ? "The copy has what the live database has. The restore worked."
      : "The copy is missing data. Don't rely on this backup until you know why.",
  );
  return { ok, lines };
}

/** The same database address, at another host: the copy has the live database's logins. */
export function atHost(databaseUrl: string, host: string) {
  const url = new URL(databaseUrl);
  url.hostname = host;
  return url.toString();
}
