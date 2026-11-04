import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { type DraftInfo, get } from "../api.ts";
import { CastField, SavedCheckbox } from "./CastPage.tsx";
import { type DraftEdits, useDraftEdits, useDraftPresence } from "./DraftPage.tsx";

function Space({
  space,
  conditions,
  canEdit,
  edits,
}: {
  space: DraftInfo["spaces"][number];
  conditions: string[];
  canEdit: boolean;
  edits: DraftEdits;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const save = (changes: object) => {
    setProblem(null);
    edits.update.mutate(
      { itemId: space.id, changes },
      { onError: (error) => setProblem(error.message) },
    );
  };
  const toggleCondition = (key: string, on: boolean) =>
    save({
      conditions: on ? [...space.conditions, key] : space.conditions.filter((item) => item !== key),
    });

  return (
    <li aria-label={space.name} className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <CastField
          label="Name"
          required
          value={space.name}
          canEdit={canEdit}
          onSave={(name) => save({ name })}
        />
        <CastField
          label="Description"
          value={space.description}
          canEdit={canEdit}
          onSave={(description) => save({ description: description || null })}
        />
        <div className="sm:col-span-2">
          <CastField
            label="Rules"
            multiline
            value={space.rules}
            canEdit={canEdit}
            onSave={(rules) => save({ rules: rules || null })}
          />
        </div>
      </div>
      <SavedCheckbox
        className="flex items-center gap-2 text-sm"
        disabled={!canEdit}
        checked={space.startsJoined}
        onChange={(startsJoined) => save({ startsJoined })}
      >
        Participants start out in it, so its posts are in their home feed
      </SavedCheckbox>
      {conditions.length > 1 && (
        <fieldset className="flex flex-wrap items-center gap-3 text-sm">
          <legend className="sr-only">Who sees it</legend>
          <span>Only in:</span>
          {conditions.map((key) => (
            <SavedCheckbox
              key={key}
              className="flex items-center gap-1"
              disabled={!canEdit}
              checked={space.conditions.includes(key)}
              onChange={(on) => toggleCondition(key, on)}
            >
              {key}
            </SavedCheckbox>
          ))}
          <span className="text-xs text-stone-500">None ticked means everyone sees it.</span>
        </fieldset>
      )}
      {problem && (
        <p role="alert" className="text-sm text-rose-700">
          {problem}
        </p>
      )}
      {canEdit && (
        <div className="flex items-center justify-end gap-2 text-xs text-stone-500">
          {space.usedBy > 0 && <span>{space.usedBy} posts</span>}
          <button
            type="button"
            disabled={space.usedBy > 0}
            title={space.usedBy > 0 ? "It still has posts in it." : undefined}
            onClick={() => edits.remove.mutate(space.id)}
            className="rounded border border-stone-300 px-2 py-1 text-stone-900 disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      )}
    </li>
  );
}

/** The communities in a study. Only researchers make these, and they freeze with a version. */
export function SpacesPage() {
  const { draftId } = useParams({ from: "/drafts/$draftId/spaces" });
  const info = useQuery({
    queryKey: ["draft", draftId, "info"],
    queryFn: () => get<DraftInfo>(`/admin/drafts/${draftId}`),
  });
  const edits = useDraftEdits(draftId);
  useDraftPresence(draftId, null);
  const [problem, setProblem] = useState<string | null>(null);

  if (!info.data) {
    return null;
  }
  const { spaces, canEdit, title, conditions } = info.data;

  const addSpace = () => {
    setProblem(null);
    edits.create.mutate(
      { kind: "space", fields: { name: "New space", startsJoined: true, conditions: [] } },
      { onError: (error) => setProblem(error.message) },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/drafts/$draftId" params={{ draftId }} className="text-sm underline">
          Back to the feed
        </Link>
        <h1 className="mr-auto text-lg font-semibold">
          Spaces in {title} <span className="font-normal text-stone-500">({spaces.length})</span>
        </h1>
        {canEdit && (
          <button
            type="button"
            onClick={addSpace}
            disabled={edits.create.isPending}
            className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Add a space
          </button>
        )}
      </div>
      <p className="text-sm text-stone-500">
        Communities posts can belong to. Put a post in one from the feed. Whether people can join
        and leave them is in Settings.
      </p>
      {problem && (
        <p role="alert" className="text-sm text-rose-700">
          {problem}
        </p>
      )}
      {spaces.length === 0 && (
        <p className="rounded-lg bg-white p-6 text-center text-stone-500">No spaces yet.</p>
      )}
      <ul className="space-y-3">
        {spaces.map((space) => (
          <Space
            key={space.id}
            space={space}
            conditions={conditions.map(({ key }) => key)}
            canEdit={canEdit}
            edits={edits}
          />
        ))}
      </ul>
    </div>
  );
}
