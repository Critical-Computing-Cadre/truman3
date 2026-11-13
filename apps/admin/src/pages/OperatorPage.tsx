import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { get, type OperatorTeam, send, type TeamLimits, type TeamStatus } from "../api.ts";

const STATUS_LABEL: Record<TeamStatus, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  suspended: "Suspended",
};
const STATUS_CLASS: Record<TeamStatus, string> = {
  pending: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  suspended: "bg-rose-100 text-rose-900",
};

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
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold">Labs</h1>
        <p className="text-stone-600">
          {waiting === 0
            ? "No labs are waiting for approval."
            : `${waiting} ${waiting === 1 ? "lab is" : "labs are"} waiting for approval.`}{" "}
          You see what each lab uses, never what's in its studies.
        </p>
      </div>
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
      className="flex flex-col gap-3 rounded border border-stone-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">{team.name}</h2>
        <span className={`rounded px-2 py-0.5 text-sm ${STATUS_CLASS[team.status]}`}>
          {STATUS_LABEL[team.status]}
        </span>
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
      <p className="text-sm text-stone-600">
        {team.owners.map(({ name, email }) => `${name} (${email})`).join(", ") || "No owner"} ·
        applied {date(team.createdAt)}
        {team.decidedAt && ` · last changed ${date(team.decidedAt)} by ${team.decidedBy}`}
      </p>
      <p className="text-sm">
        {usage.members} {usage.members === 1 ? "member" : "members"} · {usage.studies} studies,{" "}
        {usage.runningStudies} open · {usage.participants} participants,{" "}
        {usage.participantsLast30Days} in the last 30 days
      </p>
      <p className="text-sm">
        Claude: ${usage.hostAiUsd.toFixed(2)} on your key
        {team.limits.starterBudgetUsd !== undefined &&
          ` of a $${team.limits.starterBudgetUsd} starter budget`}
        {usage.hasOwnKey
          ? ` · its own key, $${usage.labAiUsd.toFixed(2)} so far`
          : " · no key of its own yet"}
      </p>
      <p className="text-sm">
        Photos from participants: {(usage.uploadBytes / 1024 ** 3).toFixed(2)} GB
        {team.limits.uploadsGb !== undefined && ` of ${team.limits.uploadsGb} GB`}
      </p>
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
