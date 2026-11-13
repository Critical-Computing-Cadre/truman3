import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import {
  download,
  get,
  post,
  type SimulationReport,
  type SimulationSettings,
  type Simulations,
  type Transcript,
} from "../api.ts";

const ACTION_NAMES: Record<string, [string, string]> = {
  like: ["like", "likes"],
  upvote: ["upvote", "upvotes"],
  downvote: ["downvote", "downvotes"],
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
      <div className="card overflow-x-auto">
        <table className="table" data-testid="simulated-beats">
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
        <div className="card p-3 text-sm">
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

/** One persona's run, as what they saw and did, in order. */
function TranscriptView({ transcript }: { transcript: Transcript }) {
  // How long after they joined, as "Day 2, 20:15 in".
  const time = (ms: number) => {
    const minutes = Math.floor(ms / 60_000);
    const day = Math.floor(minutes / (24 * 60)) + 1;
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    return `Day ${day}, ${hours}:${String(minutes % 60).padStart(2, "0")} in`;
  };
  // Looks where nothing new appeared and they did nothing are left out, so it reads as a story.
  const entries = transcript.entries.filter((entry) => entry.did || entry.saw.length > 0);
  return (
    <details className="card p-3 text-sm" data-testid="transcript">
      <summary className="cursor-pointer">
        <span className="font-medium">{transcript.persona}</span>, in "{transcript.condition}":{" "}
        {transcript.entries.filter((entry) => entry.did).length} things done in{" "}
        {transcript.entries.length} looks, ${transcript.costUsd.toFixed(2)}
      </summary>
      <ol className="mt-2 space-y-2">
        {entries.map((entry) => (
          // Each look is at its own time.
          <li key={entry.at} className="border-t border-stone-100 pt-2">
            <p className="text-xs text-stone-500">{time(entry.at)}</p>
            {entry.saw.length > 0 && (
              <ul className="text-stone-600">
                {entry.saw.map((item, at) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a finished transcript never changes.
                  <li key={at}>
                    <span className="font-medium">{item.who}:</span> {item.text}
                  </li>
                ))}
              </ul>
            )}
            <p className={entry.did ? "text-stone-900" : "text-stone-500"}>
              {entry.did ?? "Did nothing."} <span className="italic">"{entry.why}"</span>
            </p>
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * Simulated participants for one saved version: made-up participants who go through it on a
 * fast-forwarded clock, at random or played by a model from the study's personas, and a report on
 * what happened to them. They can be kept as synthetic data. See ADRs 59 and 60.
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
  const [mode, setMode] = useState<"random" | "personas">("random");
  const [count, setCount] = useState(50);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [budget, setBudget] = useState(2);
  const [keep, setKeep] = useState(false);
  const run = useMutation({
    mutationFn: (settings: Partial<SimulationSettings>) =>
      post<Simulations>(`/admin/versions/${versionId}/simulations`, settings),
    onSuccess: (data) => client.setQueryData(key, data),
  });
  const synthetic = useMutation({
    mutationFn: (studyId: string) =>
      download(`/admin/studies/${studyId}/export`, { synthetic: true }),
  });

  if (!simulations.data) {
    return null;
  }
  const { studyId, title, version, canRun, most, latest, personas, model, canPlay, noModel } =
    simulations.data;
  const running = latest?.status === "running";
  const playing = personas.flatMap(({ id }) => Array(chosen[id] ?? 0).fill(id) as string[]);
  const ready =
    mode === "random" ? count >= 1 && count <= most : playing.length > 0 && budget > 0 && canPlay;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">
          Simulated participants in {title}, version {version}
        </h1>
      </div>
      <p className="text-sm text-stone-500">
        Made-up participants go through this version one after another, each in a world
        fast-forwarded through the study. <strong>At random</strong>, they like, comment, reply,
        repost, follow, post, and flag, which finds beats that never happen, or happen where they
        shouldn't. It costs nothing. <strong>Personas</strong> are played by a model, from the
        study's Personas page, so you can read what each one saw and did, and what the cast said
        back. That costs model calls, up to the budget. Either way, the participants are deleted
        afterwards, unless you keep them as synthetic data.
      </p>

      {canRun && (
        <form
          className="card space-y-3 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            run.mutate(
              mode === "random"
                ? { participants: count, keep }
                : { personas: playing, budgetUsd: budget, keep },
            );
          }}
        >
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="sr-only">Who goes through it</legend>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="mode"
                checked={mode === "random"}
                onChange={() => setMode("random")}
              />
              At random
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="mode"
                checked={mode === "personas"}
                onChange={() => setMode("personas")}
              />
              Personas
            </label>
          </fieldset>

          {mode === "random" ? (
            <label className="block text-sm">
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
          ) : personas.length === 0 ? (
            <p className="text-sm text-stone-600">
              This version has no personas. Write some on the builder's Personas page, then save a
              new version.
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              {!canPlay && (
                <p role="alert" className="text-rose-700">
                  {noModel ?? "Personas need a Claude key."} Personas can't be played until then.
                </p>
              )}
              <p className="text-stone-600">How many of each, played by {model}:</p>
              <ul className="space-y-1">
                {personas.map((persona) => (
                  <li key={persona.id} className="flex items-start gap-2">
                    <input
                      type="number"
                      min={0}
                      max={20}
                      aria-label={`How many ${persona.id}`}
                      value={chosen[persona.id] ?? 0}
                      onChange={(event) =>
                        setChosen({ ...chosen, [persona.id]: Number(event.target.value) })
                      }
                      className="w-16 rounded border border-stone-300 px-2 py-0.5"
                    />
                    <span>
                      <span className="font-mono">{persona.id}</span>:{" "}
                      <span className="text-stone-600">{persona.about}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <label className="block">
                Budget, in US dollars
                <input
                  type="number"
                  min={0.1}
                  max={100}
                  step={0.1}
                  value={budget}
                  onChange={(event) => setBudget(Number(event.target.value))}
                  className="ml-2 w-24 rounded border border-stone-300 px-2 py-1"
                />
              </label>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={keep}
              onChange={(event) => setKeep(event.target.checked)}
            />
            Keep them as synthetic data. They're never in the real data, and download separately.
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={running || run.isPending || !ready}
              className="btn btn-primary"
            >
              Simulate
            </button>
            {latest && !running && (
              <button
                type="button"
                disabled={run.isPending}
                onClick={() => run.mutate(latest.settings)}
                className="btn"
              >
                Repeat the last run
              </button>
            )}
          </div>
        </form>
      )}
      {run.error && (
        <p role="alert" className="text-sm text-rose-700">
          {run.error.message}
        </p>
      )}

      {simulations.data.synthetic > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            This study has {simulations.data.synthetic} synthetic participant
            {simulations.data.synthetic === 1 ? "" : "s"}.
          </span>
          {canRun && (
            <button
              type="button"
              disabled={synthetic.isPending}
              onClick={() => synthetic.mutate(studyId)}
              className="btn"
            >
              Download synthetic data
            </button>
          )}
          {synthetic.error && (
            <span role="alert" className="text-rose-700">
              {synthetic.error.message}
            </span>
          )}
        </div>
      )}

      {!latest && <p className="text-sm text-stone-600">No simulated participants yet.</p>}
      {latest && (
        <div className="space-y-3" data-testid="simulation">
          <p className="text-xs text-stone-500">
            {latest.settings.personas
              ? `${latest.settings.personas.length} personas, with a $${(latest.settings.budgetUsd ?? 2).toFixed(2)} budget`
              : `${latest.settings.participants} participants at random, seed ${latest.settings.seed}`}
            {latest.settings.keep ? ", kept as synthetic data" : ""}, started by {latest.startedBy}{" "}
            {new Date(latest.startedAt).toLocaleString()}
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
          {latest.report && !running && (
            <>
              {(latest.report.costUsd > 0 || latest.report.castCostUsd > 0) && (
                <p className="text-sm">
                  Model calls cost ${latest.report.costUsd.toFixed(2)} for the personas and $
                  {latest.report.castCostUsd.toFixed(2)} for the cast's live writing.
                </p>
              )}
              {latest.report.transcripts.length > 0 && (
                <div className="space-y-2">
                  <h2 className="font-medium">What each persona saw and did</h2>
                  {latest.report.transcripts.map((transcript, index) => (
                    <TranscriptView
                      // biome-ignore lint/suspicious/noArrayIndexKey: a finished report never changes.
                      key={index}
                      transcript={transcript}
                    />
                  ))}
                </div>
              )}
              <Report report={latest.report} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
