import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { SCENARIOS_FILE } from "@truman3/core";
import { useState } from "react";
import { type DraftSettings, get, send } from "../api.ts";
import { SaveStatus, useDraftPresence } from "./DraftPage.tsx";

/** What a study with no scenarios starts from, which does nothing until it's saved. */
const EXAMPLE = `# Scenario tests: a made-up participant does these things, in a world fast-forwarded
# through the study, and each expect says what should be true by then.
# See docs/guides/testing-studies.md.
scenarios:
  - name: Someone replies to their first post
    condition: your-condition-here
    steps:
      - at: "0:01"
        post: Hello, everyone!
      - at: "0:05"
        expect:
          happened: [your-beat-here]
          sees: ["Welcome!"]
`;

/** The short version of the guide, beside the editor. */
function Reference() {
  const row = "border-t border-stone-200 py-1 align-top";
  return (
    <details className="rounded-lg bg-white p-3 text-sm shadow-sm" open>
      <summary className="cursor-pointer font-medium">How scenarios work</summary>
      <table className="mt-2 w-full text-left text-xs">
        <tbody>
          <tr>
            <th className={`${row} w-32 font-mono`}>condition</th>
            <td className={row}>The condition they start in</td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>at</th>
            <td className={row}>When a step happens, in hours:minutes from when they start</td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>post, comment</th>
            <td className={row}>
              They write something. A comment needs <code>on</code>: <code>{"{ post: id }"}</code>{" "}
              for one of the study's posts, or <code>{"{ beat: id }"}</code> for what a beat made
            </td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>like, repost, follow</th>
            <td className={row}>
              They like or repost something, the same as <code>on</code>, or follow someone by
              username
            </td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>expect</th>
            <td className={row}>
              <code>happened</code> and <code>notHappened</code> for beats and decision points,{" "}
              <code>condition</code>, and <code>sees</code> and <code>doesNotSee</code> for text in
              their feed
            </td>
          </tr>
        </tbody>
      </table>
    </details>
  );
}

/**
 * The study's scenario tests, written in YAML, with what's wrong with them as they're saved. It's
 * a page of the draft, so it saves, undoes, and freezes with the rest of it. They run on the
 * server when a version is saved. See ADR 57.
 */
export function ScenariosPage() {
  const { draftId } = useParams({ from: "/drafts/$draftId/scenarios" });
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["draft", draftId, "settings"],
    queryFn: () => get<DraftSettings>(`/admin/drafts/${draftId}/settings`),
  });
  useDraftPresence(draftId, null, `page:${SCENARIOS_FILE}`);
  const saved = settings.data?.pages[SCENARIOS_FILE];
  // Edits belong to the saved version they started from, so a save, here or by someone else,
  // shows what's saved now.
  const [edit, setEdit] = useState<{ base: number; text: string } | null>(null);
  const text = edit && edit.base === (saved?.revision ?? 0) ? edit.text : null;
  const setText = (value: string | null) =>
    setEdit(value === null ? null : { base: saved?.revision ?? 0, text: value });

  const save = useMutation({
    mutationFn: (value: string) =>
      send("PUT", `/admin/drafts/${draftId}/settings`, {
        section: `page:${SCENARIOS_FILE}`,
        value,
        baseRevision: saved?.revision ?? 0,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["draft", draftId] }),
  });

  if (!settings.data) {
    return null;
  }
  const { canEdit, title, issues } = settings.data;
  const shown = text ?? saved?.text ?? EXAMPLE;
  const dirty = text !== null && text !== (saved?.text ?? EXAMPLE);
  const problems = issues.filter(({ file }) => file === SCENARIOS_FILE);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/drafts/$draftId" params={{ draftId }} className="text-sm underline">
          Back to the feed
        </Link>
        <h1 className="mr-auto text-lg font-semibold">Scenario tests in {title}</h1>
        {canEdit && <SaveStatus draftId={draftId} />}
      </div>
      <p className="text-sm text-stone-500">
        A scenario is a made-up participant who does set things at set times, in a world
        fast-forwarded through the study. Each <code>expect</code> says what should be true by then.
        They run each time you save a version, and the results are beside the version on the Studies
        page, where you can run them again.
      </p>
      {!saved && (
        <p className="rounded bg-sky-50 p-2 text-sm text-sky-900">
          This study has no scenario tests yet. Here's one to start from, to change to fit your
          study. Nothing runs until it's saved.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-2">
          <textarea
            aria-label="Scenarios"
            spellCheck={false}
            rows={28}
            disabled={!canEdit || save.isPending}
            value={shown}
            onChange={(event) => setText(event.target.value)}
            className="w-full rounded border border-stone-300 p-3 font-mono text-sm"
          />
          {save.error && (
            <p role="alert" className="text-sm text-rose-700">
              {save.error.message}
            </p>
          )}
          {canEdit && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate(shown)}
                className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
              >
                {save.isPending ? "Saving…" : "Save scenarios"}
              </button>
              {dirty && (
                <button
                  type="button"
                  onClick={() => setText(null)}
                  className="rounded border border-stone-300 px-3 py-1.5 text-sm"
                >
                  Discard changes
                </button>
              )}
            </div>
          )}
          {saved && problems.length === 0 && !dirty && (
            <p role="status" className="text-sm text-emerald-800">
              No problems found.
            </p>
          )}
          {problems.length > 0 && (
            <div
              className="rounded bg-rose-50 p-3 text-sm text-rose-900"
              data-testid="scenario-problems"
            >
              <p className="font-medium">To fix in what's saved:</p>
              <ul className="list-disc pl-5">
                {problems.map(({ severity, message }) => (
                  <li key={message}>
                    {severity === "warning" ? "Check: " : ""}
                    {message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <Reference />
      </div>
    </div>
  );
}
