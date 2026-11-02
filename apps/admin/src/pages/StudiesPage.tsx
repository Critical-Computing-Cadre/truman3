import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { get, type PreviewInfo, post, type StudySummary } from "../api.ts";
import { postsThatNeverAppear } from "../timeline.ts";

const PARTICIPANT_APP = import.meta.env.VITE_PARTICIPANT_URL ?? "http://localhost:5180";

type StudyVersion = StudySummary["versions"][number];

function EditButton({ study }: { study: StudySummary }) {
  const navigate = useNavigate();
  const latest = study.versions[0];
  const open = useMutation({
    mutationFn: () => post<{ draftId: string }>(`/admin/versions/${latest?.id}/draft`),
    onSuccess: ({ draftId }) => navigate({ to: "/drafts/$draftId", params: { draftId } }),
  });

  if (study.role === "viewer") {
    return null;
  }
  // A new study has a draft before it has any versions.
  if (!latest) {
    return study.openDraftId ? (
      <Link
        to="/drafts/$draftId"
        params={{ draftId: study.openDraftId }}
        className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white"
      >
        Keep editing
      </Link>
    ) : null;
  }

  return (
    <button
      type="button"
      onClick={() => open.mutate()}
      disabled={open.isPending}
      className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
    >
      {study.openDraftId ? "Keep editing" : `Edit a copy of version ${latest.version}`}
    </button>
  );
}

/** Starts a test participant, whose data stays out of exports. */
function TryIt({ version }: { version: StudyVersion }) {
  const [condition, setCondition] = useState(version.conditions[0] ?? "");
  const start = useMutation({
    mutationFn: () => post<{ token: string }>(`/admin/versions/${version.id}/pilot`, { condition }),
  });

  if (start.data) {
    return (
      <a
        href={`${PARTICIPANT_APP}/pilot/${start.data.token}`}
        target="_blank"
        rel="noreferrer"
        onClick={() => start.reset()}
        className="rounded bg-sky-700 px-3 py-1.5 text-sm text-white"
      >
        Open as a test participant
      </a>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <select
        aria-label={`Condition to try in version ${version.version}`}
        value={condition}
        onChange={(event) => setCondition(event.target.value)}
        className="rounded border border-stone-300 bg-white px-1 py-1 text-sm"
      >
        {version.conditions.map((key) => (
          <option key={key}>{key}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => start.mutate()}
        disabled={start.isPending}
        className="rounded border border-stone-300 px-3 py-1.5 text-sm disabled:opacity-40"
      >
        Try as a participant
      </button>
    </span>
  );
}

/** Launching is what participants feel, so it says exactly what will happen first. */
function LaunchButton({ study, version }: { study: StudySummary; version: StudyVersion }) {
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const live = study.versions.find(({ id }) => id === study.liveVersionId);
  const [opened, setOpened] = useState(false);

  // Launching is the last chance to catch this, so it's worked out for each condition here.
  const info = useQuery({
    queryKey: ["preview-info", version.id],
    queryFn: () => get<PreviewInfo>(`/admin/versions/${version.id}/preview-info`),
    enabled: opened,
  });
  const neverAppear = Math.max(
    0,
    ...(info.data?.conditions ?? []).map(({ key, windowHours }) =>
      postsThatNeverAppear(info.data?.posts ?? [], key, info.data?.lengthMs ?? 0, windowHours),
    ),
  );

  const launch = useMutation({
    mutationFn: () => post(`/admin/versions/${version.id}/launch`),
    onSuccess: async () => {
      dialog.current?.close();
      await client.invalidateQueries({ queryKey: ["studies"] });
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpened(true);
          dialog.current?.showModal();
        }}
        className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white"
      >
        Launch
      </button>
      <dialog
        ref={dialog}
        aria-label={`Launch version ${version.version}`}
        className="m-auto w-[min(90vw,30rem)] rounded-lg p-6 backdrop:bg-black/50"
      >
        <h2 className="mb-2 text-lg font-semibold">Launch version {version.version}?</h2>
        <ul className="mb-4 list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>New participants will get this version, starting now.</strong>
          </li>
          {live && live.participants > 0 && (
            <li>
              The {live.participants} people on version {live.version} stay on it. Your data would
              then span two versions, which your analysis will need to account for.
            </li>
          )}
          {neverAppear > 0 && (
            <li className="text-amber-900">
              {neverAppear} posts can never appear to participants, because of when they're timed.
              You can fix this by editing a copy, and dragging them onto the timeline.
            </li>
          )}
        </ul>
        {launch.error && (
          <p role="alert" className="mb-4 text-sm text-rose-800">
            {launch.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="rounded border border-stone-300 px-3 py-1.5 text-sm"
          >
            Not yet
          </button>
          <button
            type="button"
            onClick={() => launch.mutate()}
            disabled={launch.isPending}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Launch it
          </button>
        </div>
      </dialog>
    </>
  );
}

function StopButton({ study }: { study: StudySummary }) {
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const stop = useMutation({
    mutationFn: () => post(`/admin/studies/${study.id}/stop`),
    onSuccess: async () => {
      dialog.current?.close();
      await client.invalidateQueries({ queryKey: ["studies"] });
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="rounded border border-stone-300 px-3 py-1.5 text-sm"
      >
        Stop new participants
      </button>
      <dialog
        ref={dialog}
        aria-label="Stop new participants"
        className="m-auto w-[min(90vw,30rem)] rounded-lg p-6 backdrop:bg-black/50"
      >
        <h2 className="mb-2 text-lg font-semibold">Stop new participants?</h2>
        <p className="mb-4 text-sm">
          New people won't be able to join. Anyone already in the study can still come back. You can
          launch again whenever you like.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="rounded border border-stone-300 px-3 py-1.5 text-sm"
          >
            Keep it open
          </button>
          <button
            type="button"
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
            className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Stop new participants
          </button>
        </div>
      </dialog>
    </>
  );
}

export function StudiesPage() {
  const list = useQuery({
    queryKey: ["studies"],
    queryFn: () => get<{ studies: StudySummary[] }>("/admin/studies"),
  });

  return (
    <main className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Studies</h1>
        <Link to="/studies/new" className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white">
          New study
        </Link>
      </div>
      {list.data?.studies.length === 0 && <p className="text-stone-600">No studies yet.</p>}
      <ul className="space-y-3">
        {list.data?.studies.map((study) => {
          const canChange = study.role !== "viewer";
          return (
            <li key={study.id} className="rounded-lg bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">
                    {study.versions[0]?.title ?? study.draftTitle ?? study.slug}
                  </h2>
                  <p className="text-sm text-stone-600">
                    {study.team} · {study.participants} participants ·{" "}
                    {study.liveVersionId ? (
                      <span className="font-medium text-emerald-800">Open to participants</span>
                    ) : (
                      <span className="font-medium text-stone-700">
                        Not open to new participants
                      </span>
                    )}
                  </p>
                  {study.liveVersionId && (
                    <p className="text-sm text-stone-600">
                      Study link:{" "}
                      <code className="break-all">
                        {PARTICIPANT_APP}/join/{study.slug}
                      </code>
                    </p>
                  )}
                </div>
                <EditButton study={study} />
              </div>

              <ul className="mt-3 divide-y divide-stone-200 border-t border-stone-200">
                {study.versions.map((version) => {
                  const isLive = version.id === study.liveVersionId;
                  return (
                    <li
                      key={version.id}
                      aria-label={`Version ${version.version}`}
                      className="flex flex-wrap items-center gap-2 py-2"
                    >
                      <span className="mr-auto text-sm">
                        <strong>Version {version.version}</strong> · {version.participants}{" "}
                        participants
                        {isLive && (
                          <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">
                            Live
                          </span>
                        )}
                      </span>
                      <Link
                        to="/preview/$versionId"
                        params={{ versionId: version.id }}
                        className="rounded border border-stone-300 px-3 py-1.5 text-sm"
                      >
                        See the feed
                      </Link>
                      <TryIt version={version} />
                      {canChange && !isLive && <LaunchButton study={study} version={version} />}
                      {canChange && isLive && <StopButton study={study} />}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
