import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { type Flair, textOnAccent } from "@truman3/core";
import { useRef, useState } from "react";
import { type DraftInfo, get } from "../api.ts";
import { CastField, SavedCheckbox } from "./CastPage.tsx";
import { type DraftEdits, SaveStatus, useDraftEdits, useDraftPresence } from "./DraftPage.tsx";

/** A space's list of flair. Its text is what things refer to, so it's added and removed, not edited. */
function FlairList({
  label,
  flair,
  canEdit,
  onChange,
}: {
  label: string;
  flair: Flair[];
  canEdit: boolean;
  onChange: (flair: Flair[]) => void;
}) {
  const [text, setText] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const add = () => {
    const trimmed = text.trim();
    if (trimmed && !flair.some((item) => item.text === trimmed)) {
      onChange([...flair, { text: trimmed, ...(color ? { color } : {}) }]);
      setText("");
      setColor(null);
    }
  };
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-stone-600">{label}</p>
      <ul className="flex flex-wrap gap-1.5">
        {flair.map((item) => (
          <li
            key={item.text}
            style={
              item.color
                ? { backgroundColor: item.color, color: textOnAccent(item.color) }
                : undefined
            }
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${item.color ? "" : "bg-stone-200"}`}
          >
            {item.text}
            {canEdit && (
              <button
                type="button"
                aria-label={`Remove ${item.text} from ${label}`}
                onClick={() => onChange(flair.filter((other) => other !== item))}
              >
                ×
              </button>
            )}
          </li>
        ))}
        {flair.length === 0 && <li className="text-xs text-stone-500">None yet.</li>}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            aria-label={`New flair for ${label}`}
            value={text}
            maxLength={40}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            className="rounded border border-stone-300 px-2 py-1"
          />
          <label className="flex items-center gap-1">
            Color
            <input
              type="color"
              aria-label={`Color of new flair for ${label}`}
              value={color ?? "#e7e5e4"}
              onChange={(event) => setColor(event.target.value)}
            />
          </label>
          <button type="button" onClick={add} className="underline">
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function Space({
  space,
  conditions,
  canEdit,
  flairOn,
  edits,
}: {
  space: DraftInfo["spaces"][number];
  conditions: string[];
  canEdit: boolean;
  /** Whether anyone in this study sees flair. */
  flairOn: boolean;
  edits: DraftEdits;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const uploading =
    edits.setActorPicture.isPending && edits.setActorPicture.variables?.itemId === space.id;
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
    <li aria-label={space.name} className="card space-y-2 p-3">
      <div className="flex items-center gap-3">
        {space.pictureUrl ? (
          <img src={space.pictureUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-stone-200 font-semibold text-stone-600">
            {space.name.charAt(0).toUpperCase()}
          </div>
        )}
        {canEdit && (
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={() => file.current?.click()} className="underline">
              {uploading ? "Saving..." : space.pictureUrl ? "Change picture" : "Add a picture"}
            </button>
            {space.pictureUrl && (
              <button type="button" onClick={() => save({ picture: null })} className="underline">
                Remove picture
              </button>
            )}
            <input
              ref={file}
              aria-label={`Picture of ${space.name}`}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) {
                  setProblem(null);
                  edits.setActorPicture.mutate(
                    { itemId: space.id, file: chosen },
                    { onError: (error) => setProblem(error.message) },
                  );
                }
              }}
            />
          </div>
        )}
      </div>
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
            label="Address"
            required
            value={space.key}
            canEdit={canEdit && !space.keyLocked}
            onSave={(key) => save({ key })}
          />
          <p className="mt-1 text-xs text-stone-500">
            {space.keyLocked
              ? "It's in a saved version, so this stays the same, and data reads the same across versions."
              : `Participants see /spaces/${space.key}. It follows the name until you change it.`}
          </p>
        </div>
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
      <div className="space-y-2 border-t border-stone-200 pt-2 text-sm">
        <p className="font-medium">Its look</p>
        {space.bannerUrl && (
          <img src={space.bannerUrl} alt="" className="h-20 w-full rounded object-cover" />
        )}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="cursor-pointer underline">
              {space.bannerUrl ? "Change banner" : "Add a banner"}
              <input
                aria-label={`Banner of ${space.name}`}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  if (chosen) {
                    setProblem(null);
                    edits.setActorPicture.mutate(
                      { itemId: space.id, file: chosen, field: "banner" },
                      { onError: (error) => setProblem(error.message) },
                    );
                  }
                }}
              />
            </label>
            {space.bannerUrl && (
              <button type="button" onClick={() => save({ banner: null })} className="underline">
                Remove banner
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-2">
            Color
            <input
              key={space.accent}
              aria-label={`Color of ${space.name}`}
              type="color"
              disabled={!canEdit}
              defaultValue={space.accent ?? "#57534e"}
              onBlur={(event) => {
                if (event.target.value !== space.accent) {
                  save({ accent: event.target.value });
                }
              }}
            />
          </label>
          {canEdit && space.accent && (
            <button type="button" onClick={() => save({ accent: null })} className="underline">
              Remove color
            </button>
          )}
          <span className="text-stone-500">
            {space.accent
              ? "Used for its Join button, and across its page if it has no banner."
              : "None yet. Any color works, since what goes on it is chosen to be readable."}
          </span>
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
      <label className="flex items-center gap-2 text-sm">
        Members
        <input
          key={space.members ?? ""}
          type="number"
          min="0"
          step="1"
          aria-label={`Members of ${space.name}`}
          disabled={!canEdit}
          defaultValue={space.members ?? ""}
          onBlur={(event) => {
            const text = event.target.value.trim();
            const members = text === "" ? null : Math.max(0, Math.trunc(Number(text)));
            if (members !== space.members) {
              save({ members });
            }
          }}
          className="w-28 rounded border border-stone-300 px-2 py-1"
        />
        <span className="text-xs text-stone-500">
          Blank shows no number. A participant adds one while they're in it.
        </span>
      </label>
      {flairOn && (
        <div className="space-y-2 border-t border-stone-200 pt-2 text-sm">
          <p className="font-medium">Flair</p>
          <FlairList
            label="On posts"
            flair={space.postFlair}
            canEdit={canEdit}
            onChange={(postFlair) =>
              save({
                postFlair,
                ...(postFlair.length === 0 && space.requirePostFlair
                  ? { requirePostFlair: false }
                  : {}),
              })
            }
          />
          <SavedCheckbox
            className="flex items-center gap-2"
            disabled={!canEdit || space.postFlair.length === 0}
            checked={space.requirePostFlair}
            onChange={(requirePostFlair) => save({ requirePostFlair })}
          >
            Posts participants write here have to have flair
          </SavedCheckbox>
          <FlairList
            label="On people"
            flair={space.userFlair}
            canEdit={canEdit}
            onChange={(userFlair) => save({ userFlair })}
          />
        </div>
      )}
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
            className="btn btn-sm text-stone-900"
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
        <h1 className="mr-auto text-lg font-semibold">
          Spaces in {title} <span className="font-normal text-stone-500">({spaces.length})</span>
        </h1>
        {canEdit && <SaveStatus draftId={draftId} />}
        {canEdit && (
          <button
            type="button"
            onClick={addSpace}
            disabled={edits.create.isPending}
            className="btn btn-primary"
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
            flairOn={info.data.conditions.some(({ features }) => features.flair)}
            edits={edits}
          />
        ))}
      </ul>
    </div>
  );
}
