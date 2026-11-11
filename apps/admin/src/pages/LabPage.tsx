import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { get, type Researcher, send, type TeamAi } from "../api.ts";

const dollars = (value: number) => `$${value.toFixed(2)}`;

/** Each of a researcher's labs: its own Claude key, and what it's spent on models (ADR 71). */
export function LabPage() {
  const me = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => get<Researcher>("/admin/me"),
  });
  if (!me.data) {
    return null;
  }
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">Your lab</h1>
      {me.data.teams.map((team) => (
        <TeamAiCard key={team.id} team={team} />
      ))}
    </main>
  );
}

function TeamAiCard({ team }: { team: Researcher["teams"][number] }) {
  const client = useQueryClient();
  const queryKey = ["team-ai", team.id];
  const ai = useQuery({
    queryKey,
    queryFn: () => get<TeamAi>(`/admin/teams/${team.id}/ai`),
  });
  const [key, setKey] = useState("");
  const save = useMutation({
    mutationFn: () => send<TeamAi>("PUT", `/admin/teams/${team.id}/ai`, { key }),
    onSuccess: (data) => {
      client.setQueryData(queryKey, data);
      setKey("");
    },
  });
  const remove = useMutation({
    mutationFn: () => send<TeamAi>("DELETE", `/admin/teams/${team.id}/ai`),
    onSuccess: (data) => client.setQueryData(queryKey, data),
  });
  const owner = team.role === "owner";

  if (!ai.data) {
    return null;
  }
  const { keyHint, starterBudgetUsd, hostUsd, labUsd, labLast30DaysUsd, canStore } = ai.data;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <section
      aria-label={team.name}
      className="flex flex-col gap-3 rounded border border-stone-200 bg-white p-4"
    >
      <h2 className="text-lg font-semibold">{team.name}</h2>
      <p className="text-stone-700">
        Live writing, rehearsing lines, personas, and agents use Claude. Each call costs a little,
        and is counted here.
      </p>
      {keyHint ? (
        <p>
          Your lab's own Claude key, ending <span className="font-mono">{keyHint}</span>, pays for
          its use: {dollars(labUsd)} so far, {dollars(labLast30DaysUsd)} in the last 30 days.
        </p>
      ) : (
        <p>
          {starterBudgetUsd === null
            ? `Your lab uses this Truman's own key. ${dollars(hostUsd)} so far.`
            : `Your lab is using its starter budget: ${dollars(hostUsd)} of ${dollars(starterBudgetUsd)} spent. Once it's gone, add your lab's own key to keep using Claude. Until then, studies use the fixed lines they were written with.`}
        </p>
      )}
      {canStore && owner && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 font-medium">
            {keyHint ? "Replace your lab's Claude key" : "Add your lab's Claude key"}
            <input
              type="password"
              autoComplete="off"
              required
              placeholder="sk-ant-…"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              className="rounded border border-stone-300 px-3 py-2 font-mono font-normal"
            />
          </label>
          <p className="text-sm text-stone-500">
            Make one in the Claude Console, under API keys. It's stored encrypted, and nobody can
            read it back, not even here. Your lab pays Anthropic for what it uses.
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={save.isPending || key.trim() === ""}
              className="rounded bg-stone-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Save key
            </button>
            {keyHint && (
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
                className="rounded border border-stone-300 px-3 py-1.5 text-sm"
              >
                Remove key
              </button>
            )}
          </div>
        </form>
      )}
      {canStore && !owner && (
        <p className="text-sm text-stone-500">Only your lab's owners can change its key.</p>
      )}
      {(save.error || remove.error) && (
        <p role="alert" className="text-sm text-rose-700">
          {(save.error ?? remove.error)?.message}
        </p>
      )}
    </section>
  );
}
