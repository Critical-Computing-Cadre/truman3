import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { get, post } from "../api.ts";

interface AgentRun {
  id: string;
  brief: string;
  status: "running" | "done" | "error";
  model: string;
  budgetUsd: number;
  costUsd: number;
  steps: { tool?: string; text: string; error?: boolean }[];
  summary: string | null;
  stopped: string | null;
  startedBy: string;
  startedAt: string;
}

interface AgentState {
  canRun: boolean;
  /** Why this lab can't use Claude now, or null if it can. */
  noModel: string | null;
  model: string;
  defaultBudgetUsd: number;
  runs: AgentRun[];
}

/** Things to ask for, to show what an agent can do. */
const EXAMPLES = [
  "Draft a study from this brief: a cyberbullying bystander study on a photo platform, in two conditions. In one, someone in the cast defends the person being mocked; in the other, nobody does. Add the cast, posts, beats, and scenario tests.",
  "Write personas to pilot this study: four kinds of participant who'd react differently to what happens in it.",
  "Write scenario tests for this study's beats, for each condition, and check they pass.",
];

const STOPPED: Record<string, string> = {
  done: "It finished.",
  budget: "It stopped when it reached its budget.",
  steps: "It stopped after its most steps.",
  refused: "The model declined to go on.",
};

/** One run: what was asked, each step, and what the agent said at the end. */
function RunView({ run }: { run: AgentRun }) {
  return (
    <article className="card space-y-2 p-3 text-sm" data-testid="agent-run">
      <p className="text-xs text-stone-500">
        Asked by {run.startedBy}, {new Date(run.startedAt).toLocaleString()}. {run.model}, $
        {run.costUsd.toFixed(2)} of ${run.budgetUsd.toFixed(2)}.
      </p>
      <p className="whitespace-pre-wrap">{run.brief}</p>
      <ol className="space-y-1 border-l-2 border-stone-200 pl-3">
        {run.steps.map((step, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: steps are only ever added to the end.
          <li key={index} className={step.error ? "text-rose-700" : "text-stone-700"}>
            <span className="font-mono text-xs">{step.tool}</span>{" "}
            <span className="break-words text-xs text-stone-500">
              {step.text.length > 200 ? `${step.text.slice(0, 200)}…` : step.text}
            </span>
          </li>
        ))}
      </ol>
      {run.status === "running" ? (
        <p role="status" className="text-stone-600">
          Working…
        </p>
      ) : (
        <div className="space-y-1 rounded bg-stone-50 p-2">
          {run.stopped && run.stopped !== "done" && (
            <p className="text-amber-800">{STOPPED[run.stopped] ?? run.stopped}</p>
          )}
          <p className="whitespace-pre-wrap" data-testid="agent-summary">
            {run.summary}
          </p>
        </div>
      )}
    </article>
  );
}

/**
 * Ask an agent to work on this draft: draft a whole study from a brief, or one job, like writing
 * personas or scenario tests. It works on the server, within a budget, with the same tools and
 * limits as an agent with a token, and what it writes is marked as generated. See ADR 65.
 */
export function AgentPage() {
  const { draftId } = useParams({ from: "/drafts/$draftId/agent" });
  const client = useQueryClient();
  const key = ["agent", draftId];
  const state = useQuery({
    queryKey: key,
    queryFn: () => get<AgentState>(`/admin/drafts/${draftId}/agent`),
    refetchInterval: (query) => (query.state.data?.runs[0]?.status === "running" ? 2000 : false),
  });
  const [brief, setBrief] = useState("");
  const [budget, setBudget] = useState<number | null>(null);
  const start = useMutation({
    mutationFn: () =>
      post(`/admin/drafts/${draftId}/agent`, {
        brief: brief.trim(),
        budgetUsd: budget ?? state.data?.defaultBudgetUsd ?? 2,
      }),
    onSuccess: () => {
      setBrief("");
      client.invalidateQueries({ queryKey: key });
      // What it changed shows in the builder.
      client.invalidateQueries({ queryKey: ["draft", draftId] });
    },
  });
  const running = state.data?.runs[0]?.status === "running";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (brief.trim().length >= 10) {
      start.mutate();
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <Link to="/drafts/$draftId" params={{ draftId }} className="text-sm underline">
        Back to the draft
      </Link>
      <h1 className="text-xl font-semibold">Agent</h1>
      <p className="text-sm text-stone-700">
        Ask an agent to work on this draft: draft a whole study from a brief, or one job on it, like
        writing personas or scenario tests. It checks its work, and what it writes is marked as
        generated. It can't launch the study or reach participants; it recommends what to do next,
        and you decide.
      </p>

      {state.data && !state.data.canRun ? (
        <p className="rounded bg-amber-50 p-3 text-sm">
          {state.data.noModel ?? "An agent needs a Claude key."} An agent can't run until then.
        </p>
      ) : (
        <form onSubmit={submit} className="card space-y-2 p-3">
          <label className="flex flex-col gap-1 text-sm">
            What should it do?
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              rows={6}
              maxLength={8000}
              className="rounded border border-stone-300 p-2"
            />
          </label>
          <div className="flex flex-wrap gap-2 text-xs">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="rounded-full border border-stone-300 px-2 py-0.5 text-left"
                onClick={() => setBrief(example)}
              >
                {example.split(":")[0]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Budget, in US dollars
              <input
                type="number"
                min={0.5}
                max={20}
                step={0.5}
                value={budget ?? state.data?.defaultBudgetUsd ?? 2}
                onChange={(event) => setBudget(Number(event.target.value))}
                className="w-24 rounded border border-stone-300 px-2 py-1"
              />
            </label>
            <button
              type="submit"
              disabled={running || start.isPending || brief.trim().length < 10}
              className="btn btn-primary"
            >
              Ask the agent
            </button>
            {state.data && (
              <span className="text-xs text-stone-500">
                Played by {state.data.model}. It stops at the budget.
              </span>
            )}
          </div>
          {start.error && (
            <p role="alert" className="text-sm text-rose-700">
              {start.error.message}
            </p>
          )}
        </form>
      )}

      {state.data?.runs.map((run) => (
        <RunView key={run.id} run={run} />
      ))}
    </main>
  );
}
