import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { get, type OperatorTeam, send, type TeamLimits, type TeamStatus } from "../api.ts";

const STATUS_LABEL: Record<TeamStatus, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  suspended: "Suspended",
};
const STATUS_CLASS: Record<TeamStatus, string> = {
  pending: "badge-wait",
  approved: "badge-good",
  suspended: "badge-bad",
};
const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(2);

const date = (iso: string) => new Date(iso).toLocaleDateString();

/**
 * Every lab on this Truman, for an operator: who applied, what they use, and their limits. It shows
 * counts, never a study's content or its participants' data (ADR 70).
 */
export function OperatorPage() {
  const teams = useQuery({
    queryKey: ["operator-teams"],
    queryFn: () => get<{ teams: OperatorTeam[] }>("/admin/operator/teams"),
  });

  if (teams.error) {
    return <p className="p-6">{teams.error.message}</p>;
  }
  if (!teams.data) {
    return null;
  }
  const waiting = teams.data.teams.filter(({ status }) => status === "pending").length;

  return (
    <main className="page flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Labs</h1>
        <p className="text-stone-600">
          {waiting === 0
            ? "No labs are waiting for approval."
            : `${waiting} ${waiting === 1 ? "lab is" : "labs are"} waiting for approval.`}{" "}
          You see what each lab uses, never what's in its studies.
        </p>
      </div>
      {teams.data.teams.length > 1 && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Lab</th>
                <th scope="col">Status</th>
                <th scope="col">Owner</th>
                <th scope="col" className="text-right">
                  Studies open
                </th>
                <th scope="col" className="text-right">
                  Participants, 30 days
                </th>
                <th scope="col" className="text-right">
                  Claude on your key
                </th>
                <th scope="col" className="text-right">
                  Photos
                </th>
              </tr>
            </thead>
            <tbody>
              {teams.data.teams.map((team) => (
                <tr key={team.id}>
                  <td>
                    <a href={`#lab-${team.id}`} className="font-medium text-primary underline">
                      {team.name}
                    </a>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_CLASS[team.status]}`}>
                      {STATUS_LABEL[team.status]}
                    </span>
                  </td>
                  <td className="text-stone-600">{team.owners[0]?.name ?? "No owner"}</td>
                  <td className="text-right tabular-nums">{team.usage.runningStudies}</td>
                  <td className="text-right tabular-nums">{team.usage.participantsLast30Days}</td>
                  <td className="text-right tabular-nums">${team.usage.hostAiUsd.toFixed(2)}</td>
                  <td className="text-right tabular-nums">{gb(team.usage.uploadBytes)} GB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {teams.data.teams.map((team) => (
        <TeamCard key={team.id} team={team} />
      ))}
    </main>
  );
}

function TeamCard({ team }: { team: OperatorTeam }) {
  const client = useQueryClient();
  const update = useMutation({
    mutationFn: (body: { status?: "approved" | "suspended"; limits?: TeamLimits }) =>
      send<OperatorTeam>("PATCH", `/admin/operator/teams/${team.id}`, body),
    onSuccess: () => client.invalidateQueries({ queryKey: ["operator-teams"] }),
  });
  const { usage } = team;

  return (
    <section
      aria-label={team.name}
      id={`lab-${team.id}`}
      className="card flex scroll-mt-4 flex-col gap-4 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">{team.name}</h2>
        <span className={`badge ${STATUS_CLASS[team.status]}`}>{STATUS_LABEL[team.status]}</span>
      </div>
      {team.application && (
        <div className="text-sm">
          <p>
            <span className="font-medium">{team.application.institution}</span>
            {team.application.website && (
              <>
                {" · "}
                <a
                  href={team.application.website}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline"
                >
                  web page
                </a>
              </>
            )}
          </p>
          <p className="whitespace-pre-wrap text-stone-700">{team.application.purpose}</p>
        </div>
      )}
      <dl className="facts">
        <div className="col-span-2">
          <dt>Owners</dt>
          <dd>
            {team.owners.map(({ name, email }) => `${name} (${email})`).join(", ") || "No owner"}
          </dd>
        </div>
        <div>
          <dt>Applied</dt>
          <dd>{date(team.createdAt)}</dd>
        </div>
        <div>
          <dt>Last changed</dt>
          <dd>{team.decidedAt ? `${date(team.decidedAt)} by ${team.decidedBy}` : "Never"}</dd>
        </div>
        <div>
          <dt>Members</dt>
          <dd>{usage.members}</dd>
        </div>
        <div>
          <dt>Studies</dt>
          <dd>
            {usage.studies}, {usage.runningStudies} open
          </dd>
        </div>
        <div>
          <dt>Participants</dt>
          <dd>
            {usage.participants}, {usage.participantsLast30Days} in the last 30 days
          </dd>
        </div>
        <div>
          <dt>Photos from participants</dt>
          <dd>
            {gb(usage.uploadBytes)} GB
            {team.limits.uploadsGb !== undefined && ` of ${team.limits.uploadsGb} GB`}
          </dd>
        </div>
        <div className="col-span-2">
          <dt>Claude</dt>
          <dd>
            ${usage.hostAiUsd.toFixed(2)} on your key
            {team.limits.starterBudgetUsd !== undefined &&
              ` of a $${team.limits.starterBudgetUsd} starter budget`}
            {usage.hasOwnKey
              ? ` · its own key, $${usage.labAiUsd.toFixed(2)} so far`
              : " · no key of its own yet"}
          </dd>
        </div>
      </dl>
      {/* Starts again from what's saved whenever that changes, such as on approval. */}
      <LimitsForm
        key={JSON.stringify(team.limits)}
        team={team}
        onSave={(limits) => update.mutate({ limits })}
      />
      <div className="flex flex-wrap gap-2">
        {team.status !== "approved" && (
          <button
            type="button"
            disabled={update.isPending}
            onClick={() => update.mutate({ status: "approved" })}
            className="btn btn-primary"
          >
            {team.status === "pending" ? "Approve" : "Reinstate"}
          </button>
        )}
        {team.status !== "suspended" && (
          <button
            type="button"
            disabled={update.isPending}
            onClick={() => update.mutate({ status: "suspended" })}
            className="btn btn-danger-quiet"
          >
            Suspend
          </button>
        )}
      </div>
      {team.status !== "suspended" && (
        <p className="text-xs text-stone-500">
          Suspending stops this lab's studies at once, for everyone in them, until it's reinstated.
        </p>
      )}
      {update.error && (
        <p role="alert" className="text-sm text-rose-700">
          {update.error.message}
        </p>
      )}
    </section>
  );
}

/** Each limit, where blank means none. */
function LimitsForm({
  team,
  onSave,
}: {
  team: OperatorTeam;
  onSave: (limits: TeamLimits) => void;
}) {
  const shown = (value?: number) => (value === undefined ? "" : String(value));
  const [participants, setParticipants] = useState(shown(team.limits.participantsPerMonth));
  const [running, setRunning] = useState(shown(team.limits.runningStudies));
  const [starter, setStarter] = useState(shown(team.limits.starterBudgetUsd));
  const [uploads, setUploads] = useState(shown(team.limits.uploadsGb));
  const changed =
    participants !== shown(team.limits.participantsPerMonth) ||
    running !== shown(team.limits.runningStudies) ||
    starter !== shown(team.limits.starterBudgetUsd) ||
    uploads !== shown(team.limits.uploadsGb);
  const asLimit = (value: string) => (value.trim() === "" ? undefined : Number(value));

  return (
    <form
      className="flex flex-wrap items-end gap-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        const limits: TeamLimits = {};
        const perMonth = asLimit(participants);
        const open = asLimit(running);
        if (perMonth !== undefined) {
          limits.participantsPerMonth = perMonth;
        }
        if (open !== undefined) {
          limits.runningStudies = open;
        }
        const budget = asLimit(starter);
        if (budget !== undefined) {
          limits.starterBudgetUsd = budget;
        }
        const room = asLimit(uploads);
        if (room !== undefined) {
          limits.uploadsGb = room;
        }
        onSave(limits);
      }}
    >
      <label className="flex flex-col gap-1">
        New participants a month
        <input
          type="number"
          min={0}
          placeholder="No limit"
          value={participants}
          onChange={(event) => setParticipants(event.target.value)}
          className="w-36 rounded border border-stone-300 px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-1">
        Studies open at once
        <input
          type="number"
          min={0}
          placeholder="No limit"
          value={running}
          onChange={(event) => setRunning(event.target.value)}
          className="w-36 rounded border border-stone-300 px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-1">
        Starter budget on your key ($)
        <input
          type="number"
          min={0}
          step="any"
          placeholder="No limit"
          value={starter}
          onChange={(event) => setStarter(event.target.value)}
          className="w-36 rounded border border-stone-300 px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-1">
        Participants' photos (GB)
        <input
          type="number"
          min={0}
          step="any"
          placeholder="No limit"
          value={uploads}
          onChange={(event) => setUploads(event.target.value)}
          className="w-36 rounded border border-stone-300 px-2 py-1"
        />
      </label>
      <button type="submit" disabled={!changed} className="btn">
        Save limits
      </button>
    </form>
  );
}
