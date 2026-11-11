import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { shortTime } from "@truman3/ui";
import { type FormEvent, useRef, useState } from "react";
import { download, get, post } from "../api.ts";
import { ChristofCard } from "../components/ChristofCard.tsx";

const REFRESH_MS = 15_000;

interface Monitor {
  title: string;
  slug: string;
  role: string;
  liveVersion: number | null;
  enrolled: number;
  inProgress: number;
  completed: number;
  activeRecently: number;
  declined: number;
  withdrawn: number;
  lastActivityAt: string | null;
  conditions: {
    key: string;
    expectedShare: number | null;
    enrolled: number;
    now: number;
    completed: number;
    posts: number;
    comments: number;
    likes: number;
    votes: number;
    flags: number;
  }[];
  steps: { version: number; steps: { label: string; people: number }[] }[];
  reRandomized: boolean;
  enrolledByDay: { day: string; people: number }[];
  exports: { by: string; at: string; includedRecruitmentIds: boolean; contents: string }[];
}

const input = "rounded border border-stone-300 px-2 py-1.5 text-sm";
const card = "space-y-3 rounded-lg bg-white p-4 shadow-sm";
const percent = (share: number) => `${Math.round(share * 100)}%`;

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white p-3 shadow-sm">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-sm text-stone-600">{label}</p>
    </div>
  );
}

/** One bar in a chart with a single measure, labeled so it never depends on its length. */
function Bar({ label, value, most }: { label: string; value: number; most: number }) {
  return (
    <li className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-2 text-sm">
      <span className="truncate" title={label}>
        {label}
      </span>
      <span className="h-3 rounded-r bg-stone-100">
        <span
          className="block h-3 rounded-r bg-sky-700"
          style={{ width: most > 0 ? `${(value / most) * 100}%` : 0 }}
        />
      </span>
      <span className="text-right tabular-nums">{value}</span>
    </li>
  );
}

function EnrolledByDay({ days }: { days: Monitor["enrolledByDay"] }) {
  const most = Math.max(1, ...days.map(({ people }) => people));
  return (
    <section aria-label="People joining each day" className={card}>
      <h2 className="font-semibold">People joining each day</h2>
      <div
        className="flex h-24 items-end gap-0.5"
        role="img"
        aria-label="See the list that follows"
      >
        {days.map(({ day, people }) => (
          <span
            key={day}
            title={`${day}: ${people}`}
            className="min-h-px flex-1 rounded-t bg-sky-700"
            style={{ height: `${(people / most) * 100}%` }}
          />
        ))}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-stone-600">See this as a table</summary>
        <table className="mt-2 text-left">
          <tbody>
            {days.map(({ day, people }) => (
              <tr key={day}>
                <td className="pr-4">{day}</td>
                <td className="tabular-nums">{people}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function ExportCard({ studyId, monitor }: { studyId: string; monitor: Monitor }) {
  const client = useQueryClient();
  const [minDwell, setMinDwell] = useState("");
  const [maxDwell, setMaxDwell] = useState("");
  const [withIds, setWithIds] = useState(false);

  const run = useMutation({
    mutationFn: () =>
      download(`/admin/studies/${studyId}/export`, {
        ...(minDwell === "" ? {} : { minDwellMs: Number(minDwell) }),
        ...(maxDwell === "" ? {} : { maxDwellMs: Number(maxDwell) }),
        ...(withIds ? { includeRecruitmentIds: true } : {}),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["monitor", studyId] }),
  });

  const photos = useMutation({
    mutationFn: () => download(`/admin/studies/${studyId}/photos`, {}),
    onSuccess: () => client.invalidateQueries({ queryKey: ["monitor", studyId] }),
  });

  if (monitor.role === "viewer") {
    return null;
  }

  return (
    <section aria-label="Download the data" className={card}>
      <h2 className="font-semibold">Download the data</h2>
      <p className="text-sm text-stone-600">
        A zip file with what people did, what they were shown, a summary per person, and a codebook
        explaining all of it. Test participants aren't included.
      </p>
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Shortest view to count (ms)
          <input
            type="number"
            min="0"
            value={minDwell}
            onChange={(event) => setMinDwell(event.target.value)}
            className={`${input} w-32`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Longest view to count (ms)
          <input
            type="number"
            min="1"
            value={maxDwell}
            onChange={(event) => setMaxDwell(event.target.value)}
            className={`${input} w-32`}
          />
        </label>
      </div>
      <p className="text-xs text-stone-500">
        These only change the summary. Every view stays in the full data. Blank counts them all.
      </p>
      {monitor.role === "owner" && (
        <label className="flex items-baseline gap-2 text-sm">
          <input
            type="checkbox"
            checked={withIds}
            onChange={(event) => setWithIds(event.target.checked)}
          />
          <span>
            Include recruitment IDs{" "}
            <span className="text-xs text-stone-500">
              Links study data to people, for things like paying bonuses. Don't share this file.
            </span>
          </span>
        </label>
      )}
      {run.error && (
        <p role="alert" className="text-sm text-rose-700">
          {run.error.message}
        </p>
      )}
      <button
        type="button"
        disabled={run.isPending}
        onClick={() => run.mutate()}
        className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
      >
        {run.isPending ? "Preparing..." : "Download"}
      </button>
      <div className="border-t border-stone-200 pt-3 text-sm">
        <p className="mb-2 text-stone-600">
          Photos participants uploaded are a separate download, since there can be a lot of them. It
          includes photos.csv, which ties each one to the data. Test participants aren't included.
        </p>
        <button
          type="button"
          disabled={photos.isPending}
          onClick={() => photos.mutate()}
          className="rounded border border-stone-300 px-3 py-1.5 disabled:opacity-40"
        >
          {photos.isPending ? "Preparing..." : "Download photos"}
        </button>
        {photos.error && (
          <p role="alert" className="mt-2 text-rose-800">
            {photos.error.message}
          </p>
        )}
      </div>
      {monitor.exports.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-stone-600">Who has downloaded it</summary>
          <ul className="mt-1 space-y-0.5 text-stone-600">
            {monitor.exports.map(({ by, at, includedRecruitmentIds, contents }) => (
              <li key={`${by}${at}`}>
                {by}, {new Date(at).toLocaleString()}
                {includedRecruitmentIds ? ", with recruitment IDs" : ""}
                {contents === "photos" ? ", the photos" : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function WithdrawCard({ studyId, monitor }: { studyId: string; monitor: Monitor }) {
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [externalId, setExternalId] = useState("");
  const [reason, setReason] = useState("Participant asked to withdraw");

  const withdraw = useMutation({
    mutationFn: () =>
      post<{ eventsDeleted: number }>(`/admin/studies/${studyId}/withdraw`, { externalId, reason }),
    onSuccess: async () => {
      setExternalId("");
      await client.invalidateQueries({ queryKey: ["monitor", studyId] });
    },
    onSettled: () => dialog.current?.close(),
  });

  if (monitor.role === "viewer") {
    return null;
  }

  const ask = (event: FormEvent) => {
    event.preventDefault();
    withdraw.reset();
    dialog.current?.showModal();
  };

  return (
    <section aria-label="Withdraw a participant" className={card}>
      <h2 className="font-semibold">Withdraw a participant</h2>
      <p className="text-sm text-stone-600">
        Deletes everything about them, and stops their ID entering this study again. They can still
        join other studies.
      </p>
      <form onSubmit={ask} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Their recruitment ID
          <input
            required
            autoComplete="off"
            value={externalId}
            onChange={(event) => setExternalId(event.target.value)}
            className={input}
          />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
          Reason
          <input
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={input}
          />
        </label>
        <button
          type="submit"
          className="rounded border border-rose-700 px-3 py-1.5 text-sm text-rose-800"
        >
          Withdraw
        </button>
      </form>
      {withdraw.data && (
        <p role="status" className="text-sm text-emerald-800">
          Withdrawn. {withdraw.data.eventsDeleted} recorded events were deleted.
        </p>
      )}
      {withdraw.error && (
        <p role="alert" className="text-sm text-rose-700">
          {withdraw.error.message}
        </p>
      )}
      <dialog
        ref={dialog}
        aria-label="Confirm withdrawal"
        className="m-auto w-[min(90vw,28rem)] rounded-lg p-6 backdrop:bg-black/50"
      >
        <h3 className="mb-2 text-lg font-semibold">Delete this participant's data?</h3>
        <p className="mb-4 text-sm">
          This permanently deletes everything about <strong>{externalId}</strong> in this study. It
          can't be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="rounded border border-stone-300 px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate()}
            className="rounded bg-rose-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Delete their data
          </button>
        </div>
      </dialog>
    </section>
  );
}

const lastActivity = (at: string) => {
  const time = shortTime(at);
  return time === "now" ? "just now" : `${time} ago`;
};

/** How a running study is going, and what you can do about it. Refreshes on its own. */
export function MonitorPage() {
  const { studyId } = useParams({ from: "/studies/$studyId/monitor" });
  const query = useQuery({
    queryKey: ["monitor", studyId],
    queryFn: () => get<Monitor>(`/admin/studies/${studyId}/monitor`),
    refetchInterval: REFRESH_MS,
  });

  if (!query.data) {
    return null;
  }
  const monitor = query.data;
  const th = "px-2 py-1 font-medium";
  const td = "px-2 py-1 tabular-nums";

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4">
      <div>
        <Link to="/" className="text-sm underline">
          Back to studies
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{monitor.title}</h1>
        <p className="text-sm text-stone-600">
          {monitor.liveVersion === null ? (
            "Not open to new participants"
          ) : (
            <span className="font-medium text-emerald-800">
              Open to participants, on version {monitor.liveVersion}
            </span>
          )}
          {monitor.lastActivityAt && ` · Last activity ${lastActivity(monitor.lastActivityAt)}`}
          {" · Test participants aren't counted"}
        </p>
        {monitor.role !== "viewer" && (
          <Link
            to="/studies/$studyId/prolific"
            params={{ studyId }}
            className="mt-2 inline-block rounded border border-stone-300 bg-white px-3 py-1.5 text-sm"
          >
            Recruit on Prolific
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Joined" value={monitor.enrolled} />
        <Stat label="In progress" value={monitor.inProgress} />
        <Stat label="Finished" value={monitor.completed} />
        <Stat label="Active in the last 15 minutes" value={monitor.activeRecently} />
      </div>
      {(monitor.declined > 0 || monitor.withdrawn > 0) && (
        <p className="text-sm text-stone-600">
          Not counted above, because their data was deleted: {monitor.declined} declined consent,{" "}
          {monitor.withdrawn} withdrew.
        </p>
      )}

      <section aria-label="By condition" className={`${card} overflow-x-auto`}>
        <h2 className="font-semibold">By condition</h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 text-stone-600">
            <tr>
              <th className={th}>Condition</th>
              <th className={th}>{monitor.reRandomized ? "Started here" : "People"}</th>
              {monitor.reRandomized && <th className={th}>In it now</th>}
              <th className={th}>Share (planned)</th>
              <th className={th}>Finished</th>
              <th className={th}>Posts</th>
              <th className={th}>Comments</th>
              <th className={th}>Likes</th>
              <th className={th}>Votes</th>
              <th className={th}>Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {monitor.conditions.map((arm) => (
              <tr key={arm.key}>
                <td className="px-2 py-1 font-medium">{arm.key}</td>
                <td className={td}>{arm.enrolled}</td>
                {monitor.reRandomized && <td className={td}>{arm.now}</td>}
                <td className={td}>
                  {monitor.enrolled > 0 ? percent(arm.enrolled / monitor.enrolled) : "-"}
                  {arm.expectedShare !== null && (
                    <span className="text-stone-500"> ({percent(arm.expectedShare)})</span>
                  )}
                </td>
                <td className={td}>{arm.completed}</td>
                <td className={td}>{arm.posts}</td>
                <td className={td}>{arm.comments}</td>
                <td className={td}>{arm.likes}</td>
                <td className={td}>{arm.votes}</td>
                <td className={td}>{arm.flags}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {monitor.steps.map(({ version, steps }) => (
        <section
          key={version}
          aria-label={`Where people are in version ${version}`}
          className={card}
        >
          <h2 className="font-semibold">
            Where people in progress are{monitor.steps.length > 1 ? `, version ${version}` : ""}
          </h2>
          <ul className="space-y-1">
            {steps.map(({ label, people }, index) => (
              <Bar
                // biome-ignore lint/suspicious/noArrayIndexKey: two steps can have the same label
                key={index}
                label={label}
                value={people}
                most={Math.max(...steps.map((step) => step.people))}
              />
            ))}
          </ul>
          <p className="text-xs text-stone-500">
            Someone whose time has run out shows in the feed until they next visit.
          </p>
        </section>
      ))}

      {monitor.enrolledByDay.length > 1 && <EnrolledByDay days={monitor.enrolledByDay} />}
      <ChristofCard studyId={studyId} canEdit={monitor.role !== "viewer"} />
      <ExportCard studyId={studyId} monitor={monitor} />
      <WithdrawCard studyId={studyId} monitor={monitor} />
    </main>
  );
}
