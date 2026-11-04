import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Avatar } from "@truman3/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type DraftInfo, get } from "../api.ts";
import { type DraftEdits, SaveStatus, useDraftEdits, useDraftPresence } from "./DraftPage.tsx";

const input = "rounded border border-stone-300 px-2 py-1 text-sm disabled:bg-stone-100";
const labelClass = "flex flex-col gap-1 text-xs font-medium text-stone-600";

/** A checkbox that saves. It shows the change right away, rather than waiting for the save. */
export function SavedCheckbox({
  checked,
  disabled,
  onChange,
  className,
  children,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  className: string;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(checked);
  useEffect(() => setShown(checked), [checked]);
  return (
    <label className={className}>
      <input
        type="checkbox"
        disabled={disabled}
        checked={shown}
        onChange={(event) => {
          setShown(event.target.checked);
          onChange(event.target.checked);
        }}
      />
      {children}
    </label>
  );
}

/** A field that saves when you click away, like the text of a post. */
export function CastField({
  label,
  value,
  canEdit,
  required = false,
  multiline = false,
  onSave,
}: {
  label: string;
  value: string;
  canEdit: boolean;
  required?: boolean;
  multiline?: boolean;
  onSave: (value: string) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const finish = () => {
    if (typed !== null && typed !== value && (typed.trim() || !required)) {
      onSave(typed.trim());
    }
    setTyped(null);
  };

  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: it holds one of these two controls
    <label className={labelClass}>
      {label}
      {multiline ? (
        <textarea
          rows={2}
          disabled={!canEdit}
          value={typed ?? value}
          onBlur={finish}
          onChange={(event) => setTyped(event.target.value)}
          className={input}
        />
      ) : (
        <input
          disabled={!canEdit}
          value={typed ?? value}
          onBlur={finish}
          onChange={(event) => setTyped(event.target.value)}
          className={input}
        />
      )}
    </label>
  );
}

function Person({
  actor,
  canEdit,
  karmaOn,
  edits,
}: {
  actor: DraftInfo["actors"][number];
  canEdit: boolean;
  /** Whether anyone in this study sees karma. */
  karmaOn: boolean;
  edits: DraftEdits;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const save = (changes: object) => {
    setProblem(null);
    edits.update.mutate(
      { itemId: actor.id, changes },
      { onError: (error) => setProblem(error.message) },
    );
  };

  return (
    <li
      aria-label={actor.name}
      className="flex flex-wrap gap-3 rounded-lg bg-white p-3 shadow-sm sm:flex-nowrap"
    >
      <div className="flex flex-col items-center gap-1">
        <Avatar seed={actor.username} url={actor.pictureUrl} size="h-16 w-16" />
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => file.current?.click()}
              className="text-xs underline"
            >
              {edits.setActorPicture.isPending &&
              edits.setActorPicture.variables?.itemId === actor.id
                ? "Saving..."
                : "Change"}
            </button>
            <input
              ref={file}
              aria-label={`Picture of ${actor.name}`}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) {
                  setProblem(null);
                  edits.setActorPicture.mutate(
                    { itemId: actor.id, file: chosen },
                    { onError: (error) => setProblem(error.message) },
                  );
                }
              }}
            />
          </>
        )}
      </div>
      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
        <CastField
          label="Name"
          required
          value={actor.name}
          canEdit={canEdit}
          onSave={(name) => save({ name })}
        />
        <CastField
          label="Username"
          required
          value={actor.username}
          canEdit={canEdit}
          onSave={(username) => save({ username })}
        />
        <CastField
          label="Location"
          value={actor.location}
          canEdit={canEdit}
          onSave={(location) => save({ location })}
        />
        <CastField
          label="Bio"
          multiline
          value={actor.bio}
          canEdit={canEdit}
          onSave={(bio) => save({ bio })}
        />
        {karmaOn && (
          <CastField
            label="Karma"
            value={String(actor.karma)}
            canEdit={canEdit}
            onSave={(text) => {
              const karma = Number(text);
              if (Number.isInteger(karma)) {
                save({ karma });
              } else {
                setProblem("Karma has to be a whole number.");
              }
            }}
          />
        )}
        <SavedCheckbox
          className="flex items-center gap-2 text-xs font-medium text-stone-600"
          disabled={!canEdit}
          checked={actor.moderator}
          onChange={(moderator) => save({ moderator })}
        >
          Show a moderator tag on their name
        </SavedCheckbox>
        {problem && (
          <p role="alert" className="text-sm text-rose-700 sm:col-span-2">
            {problem}
          </p>
        )}
      </div>
      {canEdit && (
        <div className="flex flex-col items-end gap-1 text-xs text-stone-500">
          <button
            type="button"
            disabled={actor.usedBy > 0}
            title={actor.usedBy > 0 ? "They still have posts or comments." : undefined}
            onClick={() => edits.remove.mutate(actor.id)}
            className="rounded border border-stone-300 px-2 py-1 text-stone-900 disabled:opacity-40"
          >
            Remove
          </button>
          {actor.usedBy > 0 && <span>{actor.usedBy} items</span>}
        </div>
      )}
    </li>
  );
}

/** The fake users in a study: who they are, and what their profile says. */
export function CastPage() {
  const { draftId } = useParams({ from: "/drafts/$draftId/cast" });
  const info = useQuery({
    queryKey: ["draft", draftId, "info"],
    queryFn: () => get<DraftInfo>(`/admin/drafts/${draftId}`),
  });
  const edits = useDraftEdits(draftId);
  const others = useDraftPresence(draftId, null);
  const [problem, setProblem] = useState<string | null>(null);

  if (!info.data) {
    return null;
  }
  const { actors, canEdit, title } = info.data;

  const addPerson = () => {
    setProblem(null);
    const id = crypto.randomUUID().slice(0, 8);
    edits.create.mutate(
      { kind: "actor", fields: { name: "New person", username: `person-${id}`, conditions: [] } },
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
          Cast of {title} <span className="font-normal text-stone-500">({actors.length})</span>
        </h1>
        {canEdit && <SaveStatus draftId={draftId} />}
        {canEdit && (
          <button
            type="button"
            onClick={addPerson}
            disabled={edits.create.isPending}
            className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Add a person
          </button>
        )}
      </div>
      <p className="text-sm text-stone-500">
        The people participants see in the feed. Anyone without a picture gets one made from their
        username.
      </p>
      {others.length > 0 && (
        <p className="text-xs" data-testid="also-here">
          <span className="rounded bg-sky-100 px-2 py-0.5 text-sky-900">
            Also here: {others.map(({ name }) => name).join(", ")}
          </span>
        </p>
      )}
      {problem && (
        <p role="alert" className="text-sm text-rose-700">
          {problem}
        </p>
      )}
      {actors.length === 0 && (
        <p className="rounded-lg bg-white p-6 text-center text-stone-500">
          Nobody yet. Add someone so they can write posts.
        </p>
      )}
      <ul className="space-y-2">
        {actors.map((actor) => (
          <Person
            karmaOn={info.data.conditions.some(({ features }) => features.karma)}
            key={actor.id}
            actor={actor}
            canEdit={canEdit}
            edits={edits}
          />
        ))}
      </ul>
    </div>
  );
}
