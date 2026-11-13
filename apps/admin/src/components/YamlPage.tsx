import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { type DraftSettings, get, send } from "../api.ts";
import { SaveStatus, useDraftPresence } from "../pages/DraftPage.tsx";

/**
 * A YAML file of the draft, like scenarios.yaml or personas.yaml, written beside its reference,
 * with what's wrong with it as it's saved. It's a page of the draft, so it saves, undoes, and
 * freezes with the rest of it.
 */
export function YamlPage({
  draftId,
  file,
  heading,
  intro,
  empty,
  example,
  label,
  saveLabel,
  reference,
}: {
  draftId: string;
  file: string;
  /** Followed by the study's title. */
  heading: string;
  intro: ReactNode;
  /** Shown when nothing is saved yet, above the example. */
  empty: string;
  example: string;
  /** The editor's accessible name. */
  label: string;
  saveLabel: string;
  reference: ReactNode;
}) {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["draft", draftId, "settings"],
    queryFn: () => get<DraftSettings>(`/admin/drafts/${draftId}/settings`),
  });
  useDraftPresence(draftId, null, `page:${file}`);
  const saved = settings.data?.pages[file];
  // Edits belong to the saved version they started from, so a save, here or by someone else,
  // shows what's saved now.
  const [edit, setEdit] = useState<{ base: number; text: string } | null>(null);
  const text = edit && edit.base === (saved?.revision ?? 0) ? edit.text : null;
  const setText = (value: string | null) =>
    setEdit(value === null ? null : { base: saved?.revision ?? 0, text: value });

  const save = useMutation({
    mutationFn: (value: string) =>
      send("PUT", `/admin/drafts/${draftId}/settings`, {
        section: `page:${file}`,
        value,
        baseRevision: saved?.revision ?? 0,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["draft", draftId] }),
  });

  if (!settings.data) {
    return null;
  }
  const { canEdit, title, issues } = settings.data;
  const shown = text ?? saved?.text ?? example;
  const dirty = text !== null && text !== (saved?.text ?? example);
  const problems = issues.filter((issue) => issue.file === file);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-lg font-semibold">
          {heading} {title}
        </h1>
        {canEdit && <SaveStatus draftId={draftId} />}
      </div>
      <p className="text-sm text-stone-500">{intro}</p>
      {!saved && <p className="rounded bg-sky-50 p-2 text-sm text-sky-900">{empty}</p>}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-2">
          <textarea
            aria-label={label}
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
                className="btn btn-primary"
              >
                {save.isPending ? "Saving…" : saveLabel}
              </button>
              {dirty && (
                <button type="button" onClick={() => setText(null)} className="btn">
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
              data-testid="yaml-problems"
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
        {reference}
      </div>
    </div>
  );
}
