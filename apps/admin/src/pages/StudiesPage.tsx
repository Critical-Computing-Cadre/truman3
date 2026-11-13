import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { get, type PreviewInfo, post, type StudySummary, send } from "../api.ts";
import { postsThatNeverAppear } from "../timeline.ts";

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
        className="btn btn-primary"
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
      className="btn btn-primary"
    >
      {study.openDraftId ? "Keep editing" : `Edit a copy of version ${latest.version}`}
    </button>
  );
}

/** Starts a test participant, whose data stays out of exports. */
function TryIt({ version, participantUrl }: { version: StudyVersion; participantUrl: string }) {
  const [condition, setCondition] = useState(version.conditions[0] ?? "");
  const start = useMutation({
    mutationFn: () => post<{ token: string }>(`/admin/versions/${version.id}/pilot`, { condition }),
  });

  if (start.data) {
    return (
      <a
        href={`${participantUrl}/pilot/${start.data.token}`}
        target="_blank"
        rel="noreferrer"
        onClick={() => start.reset()}
        className="btn btn-primary"
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
        className="btn"
      >
        Try as a participant
      </button>
    </span>
  );
}

/** Launching is what participants feel, so it says exactly what will happen first. */
/** The latest run of a version's scenario tests, what failed, and a button to run them again. */
function Tests({ version, canRun }: { version: StudyVersion; canRun: boolean }) {
  const client = useQueryClient();
  const run = useMutation({
    mutationFn: () => post(`/admin/versions/${version.id}/scenarios`),
    onSettled: () => client.invalidateQueries({ queryKey: ["studies"] }),
  });
  const { scenarios, latest } = version.tests;
  if (scenarios === 0) {
    return null;
  }
  const passed = latest?.results.filter((result) => result.passed).length ?? 0;
  const failed = latest?.results.filter((result) => !result.passed) ?? [];
  const summary = !latest
    ? "Tests haven't run"
    : latest.status === "running"
      ? "Running tests…"
      : latest.status === "error"
        ? "The tests couldn't finish"
        : latest.results.length === 1
          ? `The test ${latest.status}`
          : latest.status === "passed"
            ? `All ${latest.results.length} tests passed`
            : `${failed.length} of ${latest.results.length} tests failed`;
  return (
    <div className="w-full text-sm" data-testid={`tests-${version.version}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            latest?.status === "passed"
              ? "text-emerald-800"
              : latest?.status === "failed" || latest?.status === "error"
                ? "text-rose-800"
                : "text-stone-600"
          }
        >
          {summary}
          {latest?.status === "failed" && passed > 0 && ` (${passed} passed)`}
        </span>
        {latest && latest.status !== "running" && (
          <span className="text-xs text-stone-500">
            {latest.startedBy === "saving the version"
              ? "when the version was saved"
              : `run by ${latest.startedBy}`}
          </span>
        )}
        {canRun && latest?.status !== "running" && (
          <button
            type="button"
            disabled={run.isPending}
            onClick={() => run.mutate()}
            className="btn btn-sm"
          >
            {latest ? "Run tests again" : "Run tests"}
          </button>
        )}
      </div>
      {failed.length > 0 && latest?.status !== "running" && (
        <ul className="mt-1 space-y-1 rounded bg-rose-50 p-2 text-xs text-rose-900">
          {failed.map((result) => (
            <li key={result.name}>
              <p className="font-medium">{result.name}</p>
              <ul className="list-disc pl-4">
                {result.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {run.error && (
        <p role="alert" className="text-xs text-rose-800">
          {run.error.message}
        </p>
      )}
    </div>
  );
}

/** Turns the launch warning about scenario tests on or off, for one study. */
function useTestWarning(study: StudySummary) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (warn: boolean) =>
      send("PUT", `/admin/studies/${study.id}/scenario-warning`, { warn }),
    onSettled: () => client.invalidateQueries({ queryKey: ["studies"] }),
  });
}

/** Hides a study from this page, or brings it back. */
function ArchiveButton({ study }: { study: StudySummary }) {
  const client = useQueryClient();
  const archive = useMutation({
    mutationFn: () =>
      send("PUT", `/admin/studies/${study.id}/archived`, { archived: !study.archived }),
    onSettled: () => client.invalidateQueries({ queryKey: ["studies"] }),
  });
  return (
    <>
      <button
        type="button"
        disabled={archive.isPending}
        onClick={() => archive.mutate()}
        className="btn"
      >
        {study.archived ? "Restore" : "Archive"}
      </button>
      {archive.error && (
        <p role="alert" className="w-full text-sm text-rose-800">
          {archive.error.message}
        </p>
      )}
    </>
  );
}

/** Deletes an archived study for good, once its address is typed to confirm. */
function DeleteButton({ study }: { study: StudySummary }) {
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const remove = useMutation({
    mutationFn: () =>
      send("DELETE", `/admin/studies/${study.id}?confirm=${encodeURIComponent(typed)}`),
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
        className="btn btn-danger-quiet"
      >
        Delete for good
      </button>
      <dialog
        ref={dialog}
        aria-label={`Delete ${study.slug}`}
        className="m-auto w-[min(90vw,30rem)] rounded-lg p-6 backdrop:bg-black/50"
      >
        <h2 className="mb-2 text-lg font-semibold">Delete this study for good?</h2>
        <p className="mb-3 text-sm">
          Its versions, drafts, and test participants are deleted, and it can't be brought back.
          Nobody real took part in it.
        </p>
        <label className="mb-4 flex flex-col gap-1 text-sm">
          <span>
            Type <code className="font-semibold">{study.slug}</code> to confirm
          </span>
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="rounded border border-stone-300 px-2 py-1"
          />
        </label>
        {remove.error && (
          <p role="alert" className="mb-4 text-sm text-rose-800">
            {remove.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => dialog.current?.close()} className="btn">
            Keep it
          </button>
          <button
            type="button"
            disabled={typed.trim() !== study.slug || remove.isPending}
            onClick={() => remove.mutate()}
            className="btn btn-danger"
          >
            Delete it
          </button>
        </div>
      </dialog>
    </>
  );
}

/** Says the launch warning about tests is off for a study, with a way to turn it back on. */
function WarningsOff({ study }: { study: StudySummary }) {
  const warning = useTestWarning(study);
  return (
    <p className="mt-1 text-xs text-stone-500">
      Launching doesn't warn about scenario tests for this study.{" "}
      <button
        type="button"
        disabled={warning.isPending}
        onClick={() => warning.mutate(true)}
        className="underline"
      >
        Warn me again
      </button>
    </p>
  );
}

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

  const [placeholderAccepted, setPlaceholderAccepted] = useState(false);
  const warning = useTestWarning(study);
  const { tests } = version;
  const untested = study.warnUntested && tests.scenarios > 0 && tests.latest?.status !== "passed";
  const placeholderConsent = info.data?.placeholderConsent ?? false;

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
        className="btn btn-go"
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
        {untested && (
          <div role="alert" className="mb-4 rounded bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">
              {!tests.latest
                ? "This version's scenario tests haven't run."
                : tests.latest.status === "running"
                  ? "This version's scenario tests are still running."
                  : "This version's scenario tests didn't all pass."}
            </p>
            <p className="mt-1">
              They check that its beats happen when they should. You can still launch it.
            </p>
            <label className="mt-2 flex items-baseline gap-2">
              <input
                type="checkbox"
                disabled={warning.isPending}
                onChange={(event) => warning.mutate(!event.target.checked)}
              />
              Don't warn me about tests for this study
            </label>
          </div>
        )}
        {placeholderConsent && (
          <div role="alert" className="mb-4 rounded bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">The consent page still has the placeholder text.</p>
            <p className="mt-1">
              Participants would see it instead of the consent text your IRB approved. You can
              change it by editing a copy, in Settings.
            </p>
            <label className="mt-2 flex items-baseline gap-2">
              <input
                type="checkbox"
                checked={placeholderAccepted}
                onChange={(event) => setPlaceholderAccepted(event.target.checked)}
              />
              This is only a test, so launch it anyway
            </label>
          </div>
        )}
        {launch.error && (
          <p role="alert" className="mb-4 text-sm text-rose-800">
            {launch.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => dialog.current?.close()} className="btn">
            Not yet
          </button>
          <button
            type="button"
            onClick={() => launch.mutate()}
            disabled={
              launch.isPending || !info.data || (placeholderConsent && !placeholderAccepted)
            }
            className="btn btn-go"
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
      <button type="button" onClick={() => dialog.current?.showModal()} className="btn">
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
          <button type="button" onClick={() => dialog.current?.close()} className="btn">
            Keep it open
          </button>
          <button
            type="button"
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
            className="btn btn-primary"
          >
            Stop new participants
          </button>
        </div>
      </dialog>
    </>
  );
}

/**
 * Which domain a study's participants use, so the address bar needn't say "research" (ADR 74).
 * Only shown when this Truman has participant domains.
 */
function AddressPicker({ study }: { study: StudySummary }) {
  const client = useQueryClient();
  const addresses = useQuery({
    queryKey: ["addresses"],
    queryFn: () => get<{ default: string; app: string; domains: string[] }>("/admin/addresses"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const choose = useMutation({
    mutationFn: (domain: string | null) =>
      send("PUT", `/admin/studies/${study.id}/address`, { domain }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["studies"] }),
  });
  const domains = addresses.data?.domains ?? [];
  if (domains.length === 0 || study.role === "viewer") {
    return null;
  }
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-stone-600">
      Participants go to
      <select
        value={study.participantDomain ?? ""}
        disabled={choose.isPending}
        onChange={(event) => choose.mutate(event.target.value || null)}
        className="rounded border border-stone-300 px-2 py-1"
      >
        <option value="">{addresses.data?.default} (the default)</option>
        {[...domains, addresses.data?.app ?? ""]
          .filter((domain) => domain && domain !== addresses.data?.default)
          .map((domain) => (
            <option key={domain} value={domain}>
              {domain}
            </option>
          ))}
      </select>
      {choose.error && <span className="text-rose-700">{choose.error.message}</span>}
    </label>
  );
}

export function StudiesPage() {
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const list = useQuery({
    queryKey: ["studies", showArchived],
    queryFn: () =>
      get<{ studies: StudySummary[]; archivedCount: number }>(
        `/admin/studies${showArchived ? "?archived=true" : ""}`,
      ),
    // Often while tests run, so their results show when they're done.
    refetchInterval: (query) =>
      query.state.data?.studies.some((study) =>
        study.versions.some((version) => version.tests.latest?.status === "running"),
      )
        ? 2_000
        : false,
  });

  const wanted = search.trim().toLowerCase();
  const titleOf = (study: StudySummary) =>
    study.versions[0]?.title ?? study.draftTitle ?? study.slug;
  const studies = (list.data?.studies ?? []).filter(
    (study) =>
      !wanted ||
      titleOf(study).toLowerCase().includes(wanted) ||
      study.slug.toLowerCase().includes(wanted),
  );

  return (
    <main className="page">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">
          {showArchived ? "Archived studies" : "Studies"}
          {list.data && (
            <span className="ml-2 text-lg font-normal text-stone-500">
              ({list.data.studies.length})
            </span>
          )}
        </h1>
        {(showArchived || (list.data?.archivedCount ?? 0) > 0) && (
          <button type="button" onClick={() => setShowArchived(!showArchived)} className="btn">
            {showArchived ? "Back to studies" : `Archived (${list.data?.archivedCount})`}
          </button>
        )}
        <Link to="/studies/new" className="btn btn-primary">
          New study
        </Link>
      </div>
      {(list.data?.studies.length ?? 0) > 3 && (
        <input
          type="search"
          aria-label="Search studies"
          placeholder="Search by title or link"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="mb-4 w-full max-w-sm rounded-md border border-stone-300 px-3 py-1.5 text-sm"
        />
      )}
      {list.data?.studies.length === 0 && (
        <div className="card border-dashed p-8 text-center">
          <p className="text-stone-600">
            {showArchived ? "No archived studies." : "No studies yet."}
          </p>
          {!showArchived && (
            <p className="mt-1 text-sm text-stone-500">
              A new study can start from a sample, an example study, or nothing at all.
            </p>
          )}
        </div>
      )}
      {list.data && list.data.studies.length > 0 && studies.length === 0 && (
        <p className="text-stone-600">No study matches that.</p>
      )}
      <ul className="space-y-4">
        {studies.map((study) => {
          const canChange = study.role !== "viewer";
          return (
            <li key={study.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{titleOf(study)}</h2>
                    {study.archived ? (
                      <span className="badge">Archived</span>
                    ) : study.liveVersionId ? (
                      <span className="badge badge-good">Open to participants</span>
                    ) : (
                      <span className="badge">Not open to new participants</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-stone-600">
                    {study.team} · {study.participants} participants
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to="/studies/$studyId/monitor"
                    params={{ studyId: study.id }}
                    className="btn"
                  >
                    Monitor and download
                  </Link>
                  {!study.archived && <EditButton study={study} />}
                  {canChange && !study.liveVersionId && <ArchiveButton study={study} />}
                  {study.archived && study.role === "owner" && !study.notDeletable && (
                    <DeleteButton study={study} />
                  )}
                </div>
              </div>
              <div className="space-y-1 border-t border-stone-200 bg-stone-50 px-4 py-2.5">
                <p className="text-sm text-stone-600">
                  Study link:{" "}
                  <code className="break-all text-stone-900">
                    {study.participantUrl}/join/{study.slug}
                  </code>
                  {!study.liveVersionId && " (works once the study is open)"}
                </p>
                <AddressPicker study={study} />
                {study.archived && study.notDeletable && (
                  <p className="text-xs text-stone-500">{study.notDeletable}</p>
                )}
                {!study.warnUntested && canChange && <WarningsOff study={study} />}
              </div>
              <ul
                hidden={study.archived}
                className="divide-y divide-stone-200 border-t border-stone-200"
              >
                {study.versions.map((version) => {
                  const isLive = version.id === study.liveVersionId;
                  return (
                    <li
                      key={version.id}
                      aria-label={`Version ${version.version}`}
                      className="flex flex-wrap items-center gap-2 px-4 py-2.5"
                    >
                      <span className="mr-auto flex items-center gap-2 text-sm">
                        <span>
                          <strong>Version {version.version}</strong> · {version.participants}{" "}
                          participants
                        </span>
                        {isLive && <span className="badge badge-good">Live</span>}
                      </span>
                      <Link
                        to="/preview/$versionId"
                        params={{ versionId: version.id }}
                        className="btn"
                      >
                        See the feed
                      </Link>
                      <Link
                        to="/versions/$versionId/simulate"
                        params={{ versionId: version.id }}
                        className="btn"
                      >
                        Simulate
                      </Link>
                      <TryIt version={version} participantUrl={study.participantUrl} />
                      {canChange && !isLive && <LaunchButton study={study} version={version} />}
                      {canChange && isLive && <StopButton study={study} />}
                      <Tests version={version} canRun={canChange} />
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
