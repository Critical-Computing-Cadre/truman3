import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { get, type Researcher, send, type TeamAi, type TeamLimits } from "../api.ts";

const dollars = (value: number) => `$${value.toFixed(2)}`;

/**
 * Each of a researcher's labs: who's on it and who's invited (ADR 72), and on a hosted Truman its
 * own Claude key and what it's spent (ADR 71).
 */
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
        <div key={team.id} className="flex flex-col gap-3">
          <MembersCard team={team} me={me.data.email} />
          {me.data.hosted && <UsageCard team={team} />}
          {me.data.hosted && <TeamAiCard team={team} />}
        </div>
      ))}
    </main>
  );
}

interface TeamUsage {
  status: "pending" | "approved" | "suspended";
  limits: TeamLimits;
  usage: { participantsLast30Days: number; runningStudies: number; uploadBytes: number };
  key: {
    made: boolean;
    events: { at: string; kind: "used" | "changed"; action: string; by: string }[];
  };
}

/** How much of one thing a lab has used, and of how much. */
function Used({ name, used, limit }: { name: string; used: string; limit?: string }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2">
      <span>{name}</span>
      <span className="text-stone-600">
        {used}
        {limit === undefined ? ", no limit" : ` of ${limit}`}
      </span>
    </li>
  );
}

/** A lab's limits on a hosted Truman, and how much of each it has used. */
function UsageCard({ team }: { team: Researcher["teams"][number] }) {
  const usage = useQuery({
    queryKey: ["team-usage", team.id],
    queryFn: () => get<TeamUsage>(`/admin/teams/${team.id}/usage`),
  });
  if (!usage.data) {
    return null;
  }
  const { limits, usage: used, status } = usage.data;
  const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  const nearlyFull =
    limits.uploadsGb !== undefined && used.uploadBytes >= limits.uploadsGb * 1024 ** 3 * 0.8;
  return (
    <>
      <section
        aria-label={`${team.name} limits`}
        className="flex flex-col gap-3 rounded border border-stone-200 bg-white p-4"
      >
        <h2 className="text-lg font-semibold">Limits</h2>
        {status === "pending" && (
          <p className="text-sm text-stone-600">
            Your lab is waiting to be approved. Its limits are set when it is.
          </p>
        )}
        <ul className="flex flex-col gap-1 text-sm">
          <Used
            name="New participants in the last 30 days"
            used={used.participantsLast30Days.toLocaleString("en-US")}
            {...(limits.participantsPerMonth === undefined
              ? {}
              : { limit: limits.participantsPerMonth.toLocaleString("en-US") })}
          />
          <Used
            name="Studies open now"
            used={String(used.runningStudies)}
            {...(limits.runningStudies === undefined
              ? {}
              : { limit: String(limits.runningStudies) })}
          />
          <Used
            name="Photos from participants"
            used={gb(used.uploadBytes)}
            {...(limits.uploadsGb === undefined ? {} : { limit: `${limits.uploadsGb} GB` })}
          />
        </ul>
        {nearlyFull && (
          <p role="status" className="text-sm text-amber-800">
            Your lab is close to its room for photos. When it's full, participants can't add any.
          </p>
        )}
        <p className="text-sm text-stone-600">
          If a study you're planning needs more of any of these, ask whoever runs this Truman before
          you recruit.
        </p>
      </section>
      <KeyCard name={team.name} record={usage.data.key} />
    </>
  );
}

/**
 * A lab's own encryption key (ADR 82), and every time anyone but the Truman server used or changed
 * it (ADR 83). An empty list is the point: it's what a lab should expect to see.
 */
function KeyCard({ name, record }: { name: string; record: TeamUsage["key"] }) {
  return (
    <section
      aria-label={`${name} encryption key`}
      className="flex flex-col gap-3 rounded border border-stone-200 bg-white p-4"
    >
      <h2 className="text-lg font-semibold">Your lab's encryption key</h2>
      {record.made ? (
        <p className="text-sm text-stone-600">
          Your lab has a key of its own. Participants' recruitment IDs, their IP addresses if a
          study keeps them, and the photos they upload are stored under it. Only the Truman server
          can use it. Whoever runs this Truman has an emergency way in, and every use of it is
          listed here and emailed to your lab's owners.
        </p>
      ) : (
        <p className="text-sm text-stone-600">
          Your lab gets a key of its own the first time it opens a study to participants. From then
          on, recruitment IDs, IP addresses, and uploaded photos are stored under it.
        </p>
      )}
      {record.made && record.events.length === 0 && (
        <p className="text-sm">Nobody but the Truman server has used or changed it.</p>
      )}
      {record.events.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {record.events.map((event) => (
            <li key={`${event.at}${event.action}${event.by}`}>
              {new Date(event.at).toLocaleString()}: {event.kind === "used" ? "used" : "changed"} (
              {event.action}) by <code className="break-all">{event.by}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
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
      aria-label={`${team.name} Claude`}
      className="flex flex-col gap-3 rounded border border-stone-200 bg-white p-4"
    >
      <h3 className="font-semibold">Claude</h3>
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
              className="btn btn-primary"
            >
              Save key
            </button>
            {keyHint && (
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
                className="btn"
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

interface Members {
  members: { id: string; name: string; email: string; role: Role }[];
  invites: { id: string; email: string; role: Role; expiresAt: string }[];
}
type Role = "owner" | "editor" | "viewer";
const ROLE_HELP: Record<Role, string> = {
  owner: "Owner: everything, including who's on the team",
  editor: "Editor: builds, launches, and exports studies",
  viewer: "Viewer: sees studies and results, changes nothing",
};

/** Who's on a team, and invitations by email. Owners manage it; anyone can leave. */
function MembersCard({ team, me }: { team: Researcher["teams"][number]; me: string }) {
  const client = useQueryClient();
  const queryKey = ["team-members", team.id];
  const members = useQuery({
    queryKey,
    queryFn: () => get<Members>(`/admin/teams/${team.id}/members`),
  });
  const refresh = () => client.invalidateQueries({ queryKey });
  const change = useMutation({
    mutationFn: ({ method, path, body }: { method: string; path: string; body?: object }) =>
      send(method, `/admin/teams/${team.id}${path}`, body),
    onSuccess: refresh,
  });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const invite = useMutation({
    mutationFn: () => send("POST", `/admin/teams/${team.id}/invites`, { email, role }),
    onSuccess: () => {
      setEmail("");
      refresh();
    },
  });
  const owner = team.role === "owner";
  if (!members.data) {
    return null;
  }

  return (
    <section
      aria-label={`${team.name} members`}
      className="flex flex-col gap-3 rounded border border-stone-200 bg-white p-4"
    >
      <h2 className="text-lg font-semibold">{team.name}</h2>
      <ul className="flex flex-col gap-2">
        {members.data.members.map((member) => (
          <li key={member.id} className="flex flex-wrap items-center gap-2">
            <span className="mr-auto">
              {member.name} <span className="text-stone-500">{member.email}</span>
            </span>
            {owner ? (
              <select
                aria-label={`Role for ${member.name}`}
                value={member.role}
                onChange={(event) =>
                  change.mutate({
                    method: "PATCH",
                    path: `/members/${member.id}`,
                    body: { role: event.target.value },
                  })
                }
                className="rounded border border-stone-300 px-2 py-1 text-sm"
              >
                <option value="owner">Owner</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            ) : (
              <span className="text-sm capitalize">{member.role}</span>
            )}
            {(owner || member.email === me) && (
              <button
                type="button"
                onClick={() => change.mutate({ method: "DELETE", path: `/members/${member.id}` })}
                className="text-sm underline"
              >
                {member.email === me ? "Leave" : "Remove"}
              </button>
            )}
          </li>
        ))}
        {members.data.invites.map((pending) => (
          <li key={pending.id} className="flex flex-wrap items-center gap-2 text-stone-600">
            <span className="mr-auto">
              {pending.email} <span className="text-sm">invited as {pending.role}</span>
            </span>
            {owner && (
              <button
                type="button"
                onClick={() => change.mutate({ method: "DELETE", path: `/invites/${pending.id}` })}
                className="text-sm underline"
              >
                Cancel invitation
              </button>
            )}
          </li>
        ))}
      </ul>
      {owner && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            invite.mutate();
          }}
        >
          <label className="flex grow flex-col gap-1 text-sm font-medium">
            Invite by email
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded border border-stone-300 px-3 py-2 font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            As
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
              className="rounded border border-stone-300 px-2 py-2 font-normal"
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <button type="submit" disabled={invite.isPending} className="btn btn-primary py-2">
            Send invitation
          </button>
          <p className="w-full text-xs text-stone-500">
            {ROLE_HELP[role]}. The link works for 7 days.
          </p>
        </form>
      )}
      {invite.isSuccess && (
        <p role="status" className="text-sm">
          Invitation sent.
        </p>
      )}
      {(invite.error || change.error) && (
        <p role="alert" className="text-sm text-rose-700">
          {(invite.error ?? change.error)?.message}
        </p>
      )}
    </section>
  );
}
