import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Avatar } from "@truman3/ui";
import { useRef, useState } from "react";
import { type DraftInfo, get } from "../api.ts";
import { SavedCheckbox } from "../components/SavedCheckbox.tsx";
import { type DraftEdits, SaveStatus, useDraftEdits, useDraftPresence } from "./DraftPage.tsx";

const input = "rounded border border-stone-300 px-2 py-1 text-sm disabled:bg-stone-100";
const labelClass = "flex flex-col gap-1 text-xs font-medium text-stone-600";

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

/**
 * Someone's picture in each condition, where a study has more than one: the same as their picture
 * unless one is chosen, like one with a frame in some conditions (ADR 63).
 */
function ConditionPictures({
  actor,
  conditions,
  canEdit,
  edits,
  onProblem,
}: {
  actor: DraftInfo["actors"][number];
  conditions: string[];
  canEdit: boolean;
  edits: DraftEdits;
  onProblem: (problem: string | null) => void;
}) {
  const others = Object.fromEntries(
    Object.entries(actor.conditionPictures).map(([key, { key: image }]) => [key, image]),
  );
  return (
    <fieldset className="sm:col-span-2">
      <legend className="text-xs text-stone-600">Pictures by condition</legend>
      <ul className="mt-1 flex flex-wrap gap-3">
        {conditions.map((condition) => {
          const own = actor.conditionPictures[condition];
          return (
            <li key={condition} className="flex items-center gap-2 text-xs">
              <Avatar seed={actor.username} url={own?.url ?? actor.pictureUrl} size="h-8 w-8" />
              <span className="font-medium">{condition}</span>
              {canEdit && (
                <label className="cursor-pointer underline">
                  Change
                  <input
                    aria-label={`Picture of ${actor.name} in ${condition}`}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => {
                      const chosen = event.target.files?.[0];
                      if (chosen) {
                        onProblem(null);
                        edits.setActorPicture.mutate(
                          { itemId: actor.id, file: chosen, condition: { key: condition, others } },
                          { onError: (error) => onProblem(error.message) },
                        );
                      }
                    }}
                  />
                </label>
              )}
              {canEdit && own && (
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    const { [condition]: _removed, ...rest } = others;
                    edits.update.mutate(
                      { itemId: actor.id, changes: { conditionPictures: rest } },
                      { onError: (error) => onProblem(error.message) },
                    );
                  }}
                >
                  Same as their picture
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function Person({
  actor,
  conditions,
  canEdit,
  karmaOn,
  followCountsOn,
  followingOn,
  badgesOn,
  whoToFollowOn,
  bannerOn,
  flairSpaces,
  edits,
}: {
  actor: DraftInfo["actors"][number];
  /** The study's conditions. With more than one, someone can have a picture in each. */
  conditions: string[];
  canEdit: boolean;
  /** The spaces offering flair for people, where anyone in this study sees flair. */
  flairSpaces: DraftInfo["spaces"];
  /** Whether anyone in this study sees karma. */
  karmaOn: boolean;
  /** Whether anyone in this study sees follower counts, can follow, or sees badges. */
  followCountsOn: boolean;
  followingOn: boolean;
  badgesOn: boolean;
  /** Whether anyone in this study sees suggestions for who to follow. */
  whoToFollowOn: boolean;
  /** Whether profiles have a banner across the top, as in Short posts. */
  bannerOn: boolean;
  edits: DraftEdits;
}) {
  const file = useRef<HTMLInputElement>(null);
  const bannerFile = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const save = (changes: object) => {
    setProblem(null);
    edits.update.mutate(
      { itemId: actor.id, changes },
      { onError: (error) => setProblem(error.message) },
    );
  };

  return (
    <li aria-label={actor.name} className="card flex flex-wrap gap-3 p-3 sm:flex-nowrap">
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
        {bannerOn && (
          <div className="flex items-center gap-3 sm:col-span-2">
            {actor.bannerUrl ? (
              <img
                src={actor.bannerUrl}
                alt=""
                data-testid="cast-banner"
                className="h-12 w-40 rounded object-cover"
              />
            ) : (
              <span className="flex h-12 w-40 items-center justify-center rounded bg-stone-100 text-xs text-stone-500">
                No banner
              </span>
            )}
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => bannerFile.current?.click()}
                  className="text-xs underline"
                >
                  {actor.bannerUrl ? "Change banner" : "Add a banner"}
                </button>
                {actor.bannerUrl && (
                  <button
                    type="button"
                    onClick={() => save({ banner: null })}
                    className="text-xs underline"
                  >
                    Remove banner
                  </button>
                )}
                <input
                  ref={bannerFile}
                  aria-label={`Banner of ${actor.name}`}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    if (chosen) {
                      setProblem(null);
                      edits.setActorPicture.mutate(
                        { itemId: actor.id, file: chosen, field: "banner" },
                        { onError: (error) => setProblem(error.message) },
                      );
                    }
                  }}
                />
              </>
            )}
          </div>
        )}
        {conditions.length > 1 && (
          <ConditionPictures
            actor={actor}
            conditions={conditions}
            canEdit={canEdit}
            edits={edits}
            onProblem={setProblem}
          />
        )}
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
        {followCountsOn && (
          <>
            <CastField
              label="Followers"
              value={String(actor.followers)}
              canEdit={canEdit}
              onSave={(text) => {
                const followers = Number(text);
                if (Number.isInteger(followers) && followers >= 0) {
                  save({ followers });
                } else {
                  setProblem("Followers has to be a whole number.");
                }
              }}
            />
            <CastField
              label="Following"
              value={String(actor.following)}
              canEdit={canEdit}
              onSave={(text) => {
                const following = Number(text);
                if (Number.isInteger(following) && following >= 0) {
                  save({ following });
                } else {
                  setProblem("Following has to be a whole number.");
                }
              }}
            />
          </>
        )}
        {badgesOn && (
          <CastField
            label="Badge (a label you write)"
            value={actor.badge}
            canEdit={canEdit}
            onSave={(badge) => save({ badge: badge || null })}
          />
        )}
        {whoToFollowOn && (
          <SavedCheckbox
            checked={actor.suggested}
            disabled={!canEdit}
            className="flex items-center gap-2 text-sm"
            onChange={(suggested) => save({ suggested })}
          >
            Suggest following them
          </SavedCheckbox>
        )}
        {followingOn && (
          <SavedCheckbox
            checked={actor.startsFollowed !== false}
            disabled={!canEdit}
            className="flex items-center gap-2 text-sm"
            onChange={(startsFollowed) => save({ startsFollowed })}
          >
            Participants start out following them
          </SavedCheckbox>
        )}
        {flairSpaces.map((space) => (
          <label key={space.id} className={labelClass}>
            Flair in {space.name}
            <select
              className={input}
              disabled={!canEdit}
              value={actor.spaceFlair[space.id] ?? ""}
              onChange={(event) => {
                const { [space.id]: _, ...others } = actor.spaceFlair;
                save({
                  spaceFlair: event.target.value
                    ? { ...others, [space.id]: event.target.value }
                    : others,
                });
              }}
            >
              <option value="">None</option>
              {space.userFlair.map(({ text }) => (
                <option key={text} value={text}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        ))}
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
            className="btn btn-sm text-stone-900"
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
        <h1 className="mr-auto text-lg font-semibold">
          Cast of {title} <span className="font-normal text-stone-500">({actors.length})</span>
        </h1>
        {canEdit && <SaveStatus draftId={draftId} />}
        {canEdit && (
          <button
            type="button"
            onClick={addPerson}
            disabled={edits.create.isPending}
            className="btn btn-primary"
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
            followCountsOn={info.data.conditions.some(({ features }) => features.followCounts)}
            followingOn={info.data.conditions.some(({ features }) => features.following)}
            badgesOn={info.data.conditions.some(({ features }) => features.badges)}
            whoToFollowOn={info.data.conditions.some(({ features }) => features.whoToFollow)}
            bannerOn={info.data.conditions.some(({ layout }) => layout === "short-posts")}
            flairSpaces={
              info.data.conditions.some(({ features }) => features.flair)
                ? info.data.spaces.filter(({ userFlair }) => userFlair.length > 0)
                : []
            }
            key={actor.id}
            actor={actor}
            conditions={info.data.conditions.map(({ key }) => key)}
            canEdit={canEdit}
            edits={edits}
          />
        ))}
      </ul>
    </div>
  );
}

export { SavedCheckbox };
