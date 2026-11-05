import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { ModLogEntry } from "@truman3/core";
import { shortTime } from "@truman3/ui";
import { flowQuery, get } from "../api.ts";
import { rememberOpenedFrom } from "../tracking.ts";

function describe({ by, kind, authorName, space }: ModLogEntry) {
  if (kind === "person") {
    return `${by} banned ${authorName}${space ? ` from ${space.name}` : ""}`;
  }
  return authorName === null
    ? `${by} removed your ${kind}`
    : `${by} removed a ${kind} by ${authorName}`;
}

/** What moderators have done, for everyone or for one community. Arriving here is recorded as a page view. */
export function ModLogPage() {
  const { key } = useParams({ strict: false }) as { key?: string };
  const flow = useQuery(flowQuery);
  const pages = flow.data?.features.postPages ?? false;
  const log = useQuery({
    queryKey: ["mod-log", key ?? null],
    queryFn: () =>
      get<{ entries: ModLogEntry[] }>(`/mod-log${key ? `?space=${encodeURIComponent(key)}` : ""}`),
  });
  const entries = log.data?.entries ?? [];

  return (
    <div className="mx-auto max-w-xl bg-white shadow-sm sm:rounded-lg">
      <h1 className="p-4 text-xl font-semibold">Mod log</h1>
      {log.data && entries.length === 0 && (
        <p className="p-6 text-center text-stone-500">Nothing here yet.</p>
      )}
      <ul className="divide-y divide-stone-200">
        {entries.map((entry) => (
          <li key={entry.id} data-testid="mod-log-entry" className="p-3 text-sm">
            {entry.username ? (
              <Link
                to="/u/$username"
                params={{ username: entry.username }}
                className="block font-medium break-words underline-offset-2 hover:underline"
              >
                {describe(entry)}
              </Link>
            ) : pages && entry.postId ? (
              <Link
                to="/p/$postId"
                params={{ postId: entry.postId }}
                {...(entry.commentId ? { hash: `comment-${entry.commentId}` } : {})}
                onClick={() => rememberOpenedFrom("mod-log")}
                className="block font-medium break-words underline-offset-2 hover:underline"
              >
                {describe(entry)}
              </Link>
            ) : (
              <p className="font-medium break-words">{describe(entry)}</p>
            )}
            {entry.reason && <p className="break-words">Reason: {entry.reason}</p>}
            <p className="text-xs text-stone-500">
              {entry.space ? `${entry.space.name} · ` : ""}
              {shortTime(entry.at)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
