import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shortTime } from "@truman3/ui";
import { useState } from "react";
import { get, post, send } from "../api.ts";

interface ChristofState {
  hasModel: boolean;
  live: { enabled: boolean; model: string; budgetUsd: number };
  spentUsd: number;
  livePaused: boolean;
  pausedActors: string[];
  improvisers: string[];
  awaiting: Waiting[];
  runs: {
    id: string;
    beat: string;
    status: string;
    reason: string | null;
    dueAt: string;
    actor: string | null;
    pilot: boolean;
    mode: "live" | "rehearsed" | "fallback" | "fixed" | null;
    output: string | null;
    model: string | null;
    costUsd: number | null;
  }[];
}

interface Waiting {
  id: string;
  beat: string;
  note: string | null;
  action: string;
  actor: string | null;
  pilot: boolean;
  waitingSince: string;
  deadline: string | null;
  draft: string | null;
  onText: string | null;
  onAuthor: string | null;
}

const card = "space-y-3 rounded-lg bg-white p-4 shadow-sm";

/** One beat waiting for a researcher: what it's about, its line to edit, and approve or skip. */
function WaitingBeat({ studyId, item }: { studyId: string; item: Waiting }) {
  const client = useQueryClient();
  const [text, setText] = useState(item.draft ?? "");
  const decide = useMutation({
    mutationFn: (action: "approve" | "skip") =>
      post(`/admin/studies/${studyId}/christof/runs/${item.id}`, {
        action,
        ...(action === "approve" && item.draft !== null && text.trim() !== item.draft
          ? { text: text.trim() }
          : {}),
      }),
    onSettled: () => client.invalidateQueries({ queryKey: ["christof", studyId] }),
  });
  return (
    <li
      aria-label={`Waiting: ${item.beat}`}
      className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3"
    >
      <p className="flex flex-wrap gap-x-2 text-sm">
        <span className="font-mono">{item.beat}</span>
        <span>
          {item.action} by {item.actor ?? "?"}
        </span>
        {item.pilot && <span className="text-amber-700">test</span>}
        <span className="ml-auto text-xs text-stone-500">
          waiting since {shortTime(item.waitingSince)}
          {item.deadline && `, fallback at ${new Date(item.deadline).toLocaleTimeString()}`}
        </span>
      </p>
      {item.note && <p className="text-xs text-stone-600">{item.note}</p>}
      {item.onText !== null && (
        <blockquote className="border-l-2 border-stone-300 pl-2 text-sm text-stone-700">
          <span className="text-xs text-stone-500">On {item.onAuthor ?? "a post"}'s: </span>
          {item.onText || "(no text)"}
        </blockquote>
      )}
      {item.draft !== null && (
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
          The line, which you can change
          <textarea
            rows={2}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="rounded border border-stone-300 p-2 text-sm font-normal text-stone-900"
          />
        </label>
      )}
      {decide.error && (
        <p role="alert" className="text-sm text-rose-700">
          {decide.error.message}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={decide.isPending || (item.draft !== null && !text.trim())}
          onClick={() => decide.mutate("approve")}
          className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {item.draft !== null && text.trim() !== item.draft ? "Post my version" : "Approve"}
        </button>
        <button
          type="button"
          disabled={decide.isPending}
          onClick={() => decide.mutate("skip")}
          className="rounded border border-stone-300 px-3 py-1.5 text-sm"
        >
          Skip it
        </button>
      </div>
    </li>
  );
}
const dollars = (value: number) => `$${value.toFixed(2)}`;

/**
 * What Christof is doing in a study: whether actors write live, what that has cost, switches to
 * pause it for everyone or for one person in the cast, and the latest decisions with their reasons.
 */
export function ChristofCard({ studyId, canEdit }: { studyId: string; canEdit: boolean }) {
  const client = useQueryClient();
  const state = useQuery({
    queryKey: ["christof", studyId],
    queryFn: () => get<ChristofState>(`/admin/studies/${studyId}/christof`),
    // Often while something waits for a researcher, since a participant is waiting too.
    refetchInterval: (query) => ((query.state.data?.awaiting.length ?? 0) > 0 ? 5_000 : 15_000),
  });
  const control = useMutation({
    mutationFn: (body: { livePaused: boolean; pausedActors: string[] }) =>
      send("PUT", `/admin/studies/${studyId}/christof`, body),
    onSettled: () => client.invalidateQueries({ queryKey: ["christof", studyId] }),
  });

  const data = state.data;
  if (
    !data ||
    (data.runs.length === 0 && data.improvisers.length === 0 && data.awaiting.length === 0)
  ) {
    return null;
  }
  const { live, livePaused, pausedActors } = data;
  const status = !live.enabled
    ? "Live writing is off for this version, so improvised beats use their fallback lines."
    : !data.hasModel
      ? "Live writing is on, but this server has no model key, so fallback lines are used."
      : livePaused
        ? "Live writing is paused. Fallback lines are used until it's resumed."
        : `Actors write live with ${live.model}.`;

  return (
    <section aria-label="Christof" className={card}>
      <h2 className="font-semibold">Christof, the director</h2>
      {data.awaiting.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-amber-900">
            Waiting for you ({data.awaiting.length})
          </h3>
          <ul className="space-y-2">
            {data.awaiting.map((item) => (
              <WaitingBeat key={item.id} studyId={studyId} item={item} />
            ))}
          </ul>
        </div>
      )}
      {data.improvisers.length > 0 && <p className="text-sm text-stone-600">{status}</p>}
      {live.enabled && (
        <p className="text-sm" data-testid="christof-spend">
          Spent {dollars(data.spentUsd)} of {dollars(live.budgetUsd)}.
          {data.spentUsd >= live.budgetUsd && " The budget is used up, so fallback lines are used."}
        </p>
      )}
      {canEdit && live.enabled && (
        <div className="space-y-2 text-sm">
          <button
            type="button"
            disabled={control.isPending}
            onClick={() => control.mutate({ livePaused: !livePaused, pausedActors })}
            className={`rounded px-3 py-1.5 text-white ${livePaused ? "bg-emerald-700" : "bg-rose-700"}`}
          >
            {livePaused ? "Resume live writing" : "Pause all live writing"}
          </button>
          {data.improvisers.length > 0 && (
            <fieldset className="flex flex-wrap gap-3">
              <legend className="mb-1 text-xs text-stone-500">
                Pause one person, and their beats use fallback lines:
              </legend>
              {data.improvisers.map((username) => (
                <label key={username} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={pausedActors.includes(username)}
                    disabled={control.isPending}
                    onChange={(event) =>
                      control.mutate({
                        livePaused,
                        pausedActors: event.target.checked
                          ? [...pausedActors, username]
                          : pausedActors.filter((name) => name !== username),
                      })
                    }
                  />
                  {username}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      )}
      {data.runs.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            The latest decisions ({data.runs.length})
          </summary>
          <ul className="mt-2 divide-y divide-stone-100 text-sm">
            {data.runs.map((run) => (
              <li key={run.id} className="py-1.5">
                <p className="flex flex-wrap gap-x-2">
                  <span className="font-mono">{run.beat}</span>
                  <span className={run.status === "fired" ? "text-emerald-700" : "text-stone-500"}>
                    {run.status}
                  </span>
                  {run.actor && <span>by {run.actor}</span>}
                  {run.mode && (
                    <span className="text-stone-500">
                      {run.mode === "live"
                        ? `written by ${run.model}`
                        : run.mode === "rehearsed"
                          ? `rehearsed line${run.model ? `, chosen by ${run.model}` : ""}`
                          : run.mode === "fixed"
                            ? "fixed line"
                            : "fallback line"}
                      {run.costUsd ? `, ${dollars(run.costUsd)}` : ""}
                    </span>
                  )}
                  {run.pilot && <span className="text-amber-700">test</span>}
                  <span className="ml-auto text-xs text-stone-500">{shortTime(run.dueAt)}</span>
                </p>
                {run.reason && <p className="text-xs text-stone-500">{run.reason}</p>}
                {run.output && <p className="text-xs break-words">"{run.output}"</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
