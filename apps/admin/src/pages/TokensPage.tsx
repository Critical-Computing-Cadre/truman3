import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { get, post, send } from "../api.ts";

interface Token {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

const date = (iso: string) => new Date(iso).toLocaleDateString();

/**
 * Personal access tokens, for an agent working in Truman for this researcher, such as the MCP
 * server. A token can do what they can, except what reaches real participants. See ADR 64.
 */
export function TokensPage() {
  const client = useQueryClient();
  const tokens = useQuery({
    queryKey: ["tokens"],
    queryFn: () => get<{ tokens: Token[] }>("/admin/tokens"),
  });
  const [name, setName] = useState("");
  const [made, setMade] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (tokenName: string) =>
      post<Token & { token: string }>("/admin/tokens", { name: tokenName }),
    onSuccess: (token) => {
      setMade(token.token);
      setName("");
      client.invalidateQueries({ queryKey: ["tokens"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => send("DELETE", `/admin/tokens/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ["tokens"] }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) {
      create.mutate(name.trim());
    }
  };

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Access for agents</h1>
      <p className="text-sm text-stone-700">
        A token lets an agent, such as Claude through Truman's MCP server, work in Truman for you:
        read your studies, write drafts, check them, run their tests, and simulate participants.
        What it writes is marked as generated. It can't launch, stop, or delete a study, withdraw
        anyone, download real data, or touch Prolific. It can recommend those, and you do them here.
        See{" "}
        <a
          className="underline"
          href="https://truman-research.org/developers/api-and-agents"
          target="_blank"
          rel="noreferrer noopener"
        >
          The API and agents
        </a>
        .
      </p>

      <form onSubmit={submit} className="card flex flex-wrap items-end gap-2 p-3">
        <label className="flex min-w-48 flex-1 flex-col text-sm">
          What it's for
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Claude Code on my laptop"
            maxLength={100}
            className="rounded border border-stone-300 px-2 py-1"
          />
        </label>
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="btn btn-primary disabled:opacity-50"
        >
          Create a token
        </button>
      </form>

      {made && (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm"
        >
          <p className="font-semibold">Copy this now. It won't be shown again.</p>
          <code data-testid="new-token" className="block break-all rounded bg-white p-2">
            {made}
          </code>
          <p>
            Keep it like a password: in your MCP client's settings, never in a study or a shared
            file. It lasts 90 days.
          </p>
          <button type="button" className="underline" onClick={() => setMade(null)}>
            Done
          </button>
        </div>
      )}

      <section aria-label="Your tokens" className="card p-3">
        {tokens.data?.tokens.length === 0 && (
          <p className="text-sm text-stone-600">You haven't made any tokens.</p>
        )}
        <ul className="divide-y divide-stone-100">
          {tokens.data?.tokens.map((token) => (
            <li key={token.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="mr-auto font-medium">{token.name}</span>
              <span className="text-stone-600">
                Made {date(token.createdAt)}, lasts until {date(token.expiresAt)},{" "}
                {token.lastUsedAt ? `last used ${date(token.lastUsedAt)}` : "not used yet"}
              </span>
              <button type="button" className="btn btn-sm" onClick={() => revoke.mutate(token.id)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
