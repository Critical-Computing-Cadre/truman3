import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { get, post, type SimulationReport, type Simulations } from "../api.ts";

const ACTION_NAMES: Record<string, [string, string]> = {
  like: ["like", "likes"],
  comment: ["comment or reply", "comments and replies"],
  repost: ["repost", "reposts"],
  follow: ["follow", "follows"],
  post: ["post", "posts"],
  flag: ["flag", "flags"],
};

const named = (action: string, count: number) =>
  `${count} ${ACTION_NAMES[action]?.[count === 1 ? 0 : 1] ?? action}`;

/** How many of how many, with the share, as "7 of 10 (70%)". */
function share(count: number, of: number) {
  return of === 0 ? "—" : `${count} of ${of} (${Math.round((count / of) * 100)}%)`;
}

function Report({ report }: { report: SimulationReport }) {
  const conditions = Object.entries(report.conditions);
  const cell = "border-t border-stone-200 px-2 py-1 align-top";
  return (
    <div className="space-y-4">
      <p className="text-sm">
        {report.participants} participants:{" "}
        {conditions.map(([key, count]) => `${count} in "${key}"`).join(", ")}. They did{" "}
        {Object.entries(report.actions)
          .map(
            ([action, { done, refused }]) =>
              `${named(action, done)}${refused ? ` (${refused} not allowed here)` : ""}`,
          )
          .join(", ") || "nothing"}
        .
      </p>
      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-left text-sm" data-testid="simulated-beats">
          <thead>
            <tr>
              <th className="px-2 py-1">Beat</th>
              {conditions.map(([key]) => (
                <th key={key} className="px-2 py-1">
                  Happened for, in "{key}"
                </th>
              ))}
              <th className="px-2 py-1">Notes</th>
            </tr>
          </thead>
          <tbody>
            {report.beats.map((beat) => {
              const notes = [
                beat.mostForOne > 1 ? `Up to ${beat.mostForOne} times for one participant` : "",
                ...Object.entries(beat.skipped).map(
                  ([reason, count]) => `Skipped ${count} times: ${reason}`,
                ),
                beat.stillDue > 0 ? `Still due for ${beat.stillDue} when they finished` : "",
              ].filter(Boolean);
              return (
                <tr key={beat.id}>
                  <th className={`${cell} font-mono font-normal`}>{beat.id}</th>
                  {conditions.map(([key, count]) => (
                    <td key={key} className={cell}>
                      {beat.conditions.length > 0 && !beat.conditions.includes(key)
                        ? (beat.happenedFor[key] ?? 0) > 0
                          ? `${beat.happenedFor[key]}, but it isn't in this condition`
                          : "Not in this condition"
                        : share(beat.happenedFor[key] ?? 0, count)}
                    </td>
                  ))}
                  <td className={`${cell} text-xs text-stone-600`}>
                    {notes.map((note) => (
                      <p key={note}>{note}</p>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {report.decisions.length > 0 && (
        <div className="rounded-lg bg-white p-3 text-sm shadow-sm">
          <h2 className="font-medium">Decision points</h2>
          <ul className="list-disc pl-5">
            {report.decisions.map((decision) => (
              <li key={decision.id}>
                <span className="font-mono">{decision.id}</span>: decided for{" "}
                {share(decision.reached, report.participants)}
                {Object.keys(decision.to).length > 0 &&
                  `, sending ${Object.entries(decision.to)
                    .map(([key, count]) => `${count} to "${key}"`)
                    .join(", ")}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Simulated participants for one saved version: many made-up participants who go through it at
 * random, on a fast-forwarded clock, and a report on what happened to them. It finds beats that
 * never happen, or happen where they shouldn't. See ADR 59.
 */
export function SimulatePage() {
  const { versionId } = useParams({ from: "/versions/$versionId/simulate" });
  const client = useQueryClient();
  const key = ["simulations", versionId];
  const simulations = useQuery({
    queryKey: key,
    queryFn: () => get<Simulations>(`/admin/versions/${versionId}/simulations`),
    refetchInterval: (query) => (query.state.data?.latest?.status === "running" ? 2000 : false),
  });
  const [count, setCount] = useState(50);
  const run = useMutation({
    mutationFn: (settings: { participants: number; seed?: number }) =>
      post<Simulations>(`/admin/versions/${versionId}/simulations`, settings),
    onSuccess: (data) => client.setQueryData(key, data),
  });

  if (!simulations.data) {
    return null;
  }
  const { title, version, canRun, most, latest } = simulations.data;
  const running = latest?.status === "running";

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-sm underline">
          Back to studies
        </Link>
        <h1 className="text-lg font-semibold">
          Simulated participants in {title}, version {version}
        </h1>
      </div>
      <p className="text-sm text-stone-500">
        Made-up participants go through this version one after another, each in a world
        fast-forwarded through the study. They look at their feed a few times a visit, and at random
        like, comment, reply, repost, follow, post, and flag. The report shows how often each beat
        happened in each condition, so you can find ones that never happen, or happen where they
        shouldn't. Nothing costs anything: improvised lines use their rehearsed or fallback lines.
        The participants are deleted afterwards, and aren't in any download.
      </p>

      {canRun && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run.mutate({ participants: count });
          }}
        >
          <label className="text-sm">
            How many participants
            <input
              type="number"
              min={1}
              max={most}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
              className="ml-2 w-24 rounded border border-stone-300 px-2 py-1"
            />
          </label>
          <button
            type="submit"
            disabled={running || run.isPending || count < 1 || count > most}
            className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Simulate
          </button>
          {latest && !running && (
            <button
              type="button"
              disabled={run.isPending}
              onClick={() => run.mutate(latest.settings)}
              className="rounded border border-stone-300 px-3 py-1.5 text-sm"
            >
              Repeat the last run exactly
            </button>
          )}
        </form>
      )}
      {run.error && (
        <p role="alert" className="text-sm text-rose-700">
          {run.error.message}
        </p>
      )}

      {!latest && <p className="text-sm text-stone-600">No simulated participants yet.</p>}
      {latest && (
        <div className="space-y-3" data-testid="simulation">
          <p className="text-xs text-stone-500">
            {latest.settings.participants} participants, seed {latest.settings.seed}, started by{" "}
            {latest.startedBy} {new Date(latest.startedAt).toLocaleString()}
          </p>
          {running ? (
            <p role="status" className="text-sm text-stone-600">
              Simulating {latest.settings.participants} participants…
            </p>
          ) : latest.findings.length === 0 ? (
            <p role="status" className="text-sm text-emerald-800">
              Nothing stood out.
            </p>
          ) : (
            <div className="rounded bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Worth a look:</p>
              <ul className="list-disc pl-5">
                {latest.findings.map((finding) => (
                  <li key={finding}>{finding}</li>
                ))}
              </ul>
            </div>
          )}
          {latest.report && !running && <Report report={latest.report} />}
        </div>
      )}
    </div>
  );
}
