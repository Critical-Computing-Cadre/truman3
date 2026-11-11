import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { BEATS_FILE } from "@truman3/core";
import { useState } from "react";
import { type DraftSettings, get, post, send } from "../api.ts";
import { SaveStatus, useDraftPresence } from "./DraftPage.tsx";

/** What a study with no beats starts from: one beat to copy, which does nothing until it's saved. */
const EXAMPLE = `# What Christof, the director, makes happen in each participant's world.
# Times are hours:minutes from when they start. See docs/guides/writing-beats.md.
beats:
  - id: first-reply
    note: Someone replies to the participant's first post a minute or two later.
    when: { participant: post, nth: 0 }
    delay: { min: "0:01", max: "0:02" }
    do:
      action: comment
      actor: your-username-here
      on: trigger
      text: Welcome! Glad you're here.
`;

/** The short version of the guide, beside the editor. */
function Reference() {
  const row = "border-t border-stone-200 py-1 align-top";
  return (
    <details className="rounded-lg bg-white p-3 text-sm shadow-sm" open>
      <summary className="cursor-pointer font-medium">How beats work</summary>
      <table className="mt-2 w-full text-left text-xs">
        <tbody>
          <tr>
            <th className={`${row} w-40 font-mono`}>when: time</th>
            <td className={row}>At a set time, like "0:03"</td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>when: participant</th>
            <td className={row}>
              When they post, comment, like, follow, or repost. Add <code>nth</code> for only their
              nth (from 0), <code>on</code> for only on someone's, or <code>under</code> for only
              under what a beat made
            </td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>when: beat</th>
            <td className={row}>After another beat happens</td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>do: action</th>
            <td className={row}>
              post, comment, like, repost, or follow, by an <code>actor</code> in the cast
            </td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>on</th>
            <td className={row}>
              <code>trigger</code> (what set it off), <code>{"{ beat: id }"}</code> (what a beat
              made), or <code>{"{ post: id }"}</code> (one of the study's posts)
            </td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>delay, max, unless, conditions</th>
            <td className={row}>
              How long after, how many times, not after which beats, and in which conditions
            </td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>improvise, fallback</th>
            <td className={row}>
              Instead of <code>text</code>: what the actor's model writes, and the line used when it
              can't. Needs <code>live: {"{ enabled: true }"}</code>
            </td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>lines</th>
            <td className={row}>
              With <code>improvise</code>: lines written ahead, for the model to choose from. Add
              them yourself or with Rehearse. <code>live: {"{ stray: never }"}</code> keeps it to
              them
            </td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>decide</th>
            <td className={row}>
              Decision points, for adaptive designs: at a time or event, measures from what they did
              choose a group, which moves them to another condition or keeps them
            </td>
          </tr>
          <tr>
            <th className={`${row} font-mono`}>approve</th>
            <td className={row}>
              Waits for a researcher on the Monitor page to approve, change, or skip it. Or{" "}
              <code>live: {"{ approval: all }"}</code> for every beat
            </td>
          </tr>
        </tbody>
      </table>
    </details>
  );
}

interface Rehearsable {
  hasModel: boolean;
  beats: { id: string; actor: string; action: "post" | "comment" | "message"; lines: number }[];
}

/**
 * Rehearsing: the actor's model drafts lines for an improvised beat before launch, and they're
 * added to the beat's `lines` above, to read and edit like the rest. See ADR 54.
 */
function Rehearse({ draftId, disabled }: { draftId: string; disabled: boolean }) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["draft", draftId, "rehearse"],
    queryFn: () => get<Rehearsable>(`/admin/drafts/${draftId}/beats/rehearse`),
  });
  const rehearse = useMutation({
    mutationFn: (beat: string) =>
      post<{ lines: string[]; costUsd: number }>(`/admin/drafts/${draftId}/beats/rehearse`, {
        beat,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["draft", draftId] }),
  });
  if (!list.data || list.data.beats.length === 0) {
    return null;
  }
  return (
    <section aria-label="Rehearse" className="space-y-2 rounded-lg bg-white p-3 text-sm shadow-sm">
      <h2 className="font-medium">Rehearse lines</h2>
      <p className="text-xs text-stone-500">
        The actor's model drafts five lines for a beat that improvises. They're added to its{" "}
        <code>lines</code> above, for you to read and change. In the study, the model picks the one
        that fits, or, with live writing off, one is picked at random.
      </p>
      {!list.data.hasModel && (
        <p className="text-xs text-amber-800">
          This server has no model key, so it can't rehearse.
        </p>
      )}
      <ul className="space-y-1">
        {list.data.beats.map((beat) => (
          <li key={beat.id} className="flex items-center gap-2">
            <span className="mr-auto">
              <span className="font-mono">{beat.id}</span>{" "}
              <span className="text-xs text-stone-500">
                {beat.action} by {beat.actor}, {beat.lines} {beat.lines === 1 ? "line" : "lines"}
              </span>
            </span>
            <button
              type="button"
              disabled={disabled || !list.data.hasModel || rehearse.isPending}
              onClick={() => rehearse.mutate(beat.id)}
              className="rounded border border-stone-300 px-2 py-1 text-xs disabled:opacity-40"
            >
              {rehearse.isPending && rehearse.variables === beat.id ? "Rehearsing…" : "Rehearse"}
            </button>
          </li>
        ))}
      </ul>
      {rehearse.error && (
        <p role="alert" className="text-rose-700">
          {rehearse.error.message}
        </p>
      )}
      {rehearse.data && (
        <p role="status" className="text-emerald-800">
          Added {rehearse.data.lines.length} lines, for ${rehearse.data.costUsd.toFixed(2)}.
        </p>
      )}
    </section>
  );
}

/**
 * The study's beats, written in YAML, with what's wrong with them as they're saved. It's a page of
 * the draft, so it saves, undoes, and freezes with the rest of it.
 */
export function BeatsPage() {
  const { draftId } = useParams({ from: "/drafts/$draftId/beats" });
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["draft", draftId, "settings"],
    queryFn: () => get<DraftSettings>(`/admin/drafts/${draftId}/settings`),
  });
  useDraftPresence(draftId, null, `page:${BEATS_FILE}`);
  const saved = settings.data?.pages[BEATS_FILE];
  // Edits belong to the saved version they started from, so a save, here or by someone else,
  // shows what's saved now.
  const [edit, setEdit] = useState<{ base: number; text: string } | null>(null);
  const text = edit && edit.base === (saved?.revision ?? 0) ? edit.text : null;
  const setText = (value: string | null) =>
    setEdit(value === null ? null : { base: saved?.revision ?? 0, text: value });

  const save = useMutation({
    mutationFn: (value: string) =>
      send("PUT", `/admin/drafts/${draftId}/settings`, {
        section: `page:${BEATS_FILE}`,
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
  const problems = issues.filter(({ file }) => file === BEATS_FILE);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/drafts/$draftId" params={{ draftId }} className="text-sm underline">
          Back to the feed
        </Link>
        <h1 className="mr-auto text-lg font-semibold">Beats in {title}</h1>
        {canEdit && <SaveStatus draftId={draftId} />}
      </div>
      <p className="text-sm text-stone-500">
        Beats are what Christof, the director, makes happen in each participant's world, and when:
        someone replying to their first post, a pile-on three minutes in, a bystander stepping in.
        Each decision is recorded, and in the export.
      </p>
      {!saved && (
        <p className="rounded bg-sky-50 p-2 text-sm text-sky-900">
          This study has no beats yet. Here's one to start from. Nothing happens until it's saved.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-2">
          <textarea
            aria-label="Beats"
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
                {save.isPending ? "Saving…" : "Save beats"}
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
              data-testid="beat-problems"
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
        <div className="space-y-4">
          {canEdit && <Rehearse draftId={draftId} disabled={dirty || save.isPending} />}
          <Reference />
        </div>
      </div>
    </div>
  );
}
