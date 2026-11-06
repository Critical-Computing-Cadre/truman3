import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { formatStudyTime, parseStudyTime } from "@truman3/core";
import { useRef, useState } from "react";
import { type DraftInfo, get } from "../api.ts";
import { SavedCheckbox } from "../components/SavedCheckbox.tsx";
import { CastField } from "./CastPage.tsx";
import { type DraftEdits, SaveStatus, useDraftEdits, useDraftPresence } from "./DraftPage.tsx";

const LABEL = "flex flex-col gap-1 text-xs font-medium text-stone-600";
const INPUT = "rounded border border-stone-300 px-2 py-1 text-sm font-normal text-stone-900";

function StoryCard({
  story,
  info,
  edits,
}: {
  story: DraftInfo["stories"][number];
  info: DraftInfo;
  edits: DraftEdits;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const save = (changes: object) => {
    setProblem(null);
    edits.update.mutate(
      { itemId: story.id, changes },
      { onError: (error) => setProblem(error.message) },
    );
  };
  const conditions = info.conditions.map(({ key }) => key);
  return (
    <li aria-label="Story" className="flex gap-3 rounded-lg bg-white p-3 shadow-sm">
      <div className="w-24 shrink-0">
        {story.pictureUrl ? (
          <img src={story.pictureUrl} alt="" className="aspect-[9/16] w-24 rounded object-cover" />
        ) : (
          <div className="flex aspect-[9/16] w-24 items-center justify-center rounded bg-stone-100 p-2 text-center text-xs text-rose-700">
            Needs a photo
          </div>
        )}
        {info.canEdit && (
          <>
            <input
              ref={file}
              type="file"
              accept="image/*"
              aria-label="Story photo"
              className="sr-only"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) {
                  edits.setActorPicture.mutate(
                    { itemId: story.id, file: chosen },
                    { onError: (error) => setProblem(error.message) },
                  );
                }
              }}
            />
            <button
              type="button"
              onClick={() => file.current?.click()}
              className="mt-1 w-full text-xs underline"
            >
              {story.pictureUrl ? "Change photo" : "Choose a photo"}
            </button>
          </>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className={LABEL}>
            Who posts it
            <select
              disabled={!info.canEdit}
              value={story.actorId}
              onChange={(event) => save({ actorId: event.target.value })}
              className={INPUT}
            >
              {info.actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.name}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            When
            <input
              disabled={!info.canEdit}
              value={time ?? formatStudyTime(story.timeMs)}
              onChange={(event) => setTime(event.target.value)}
              onBlur={() => {
                const parsed = time === null ? null : parseStudyTime(time);
                if (time !== null && parsed === null) {
                  setProblem("Use hours:minutes, like 2:05");
                  return;
                }
                setTime(null);
                if (parsed !== null && parsed !== story.timeMs) {
                  save({ timeMs: parsed });
                }
              }}
              className={INPUT}
            />
          </label>
          <label className={LABEL}>
            Lasts (hours)
            <input
              type="number"
              min="1"
              disabled={!info.canEdit}
              defaultValue={story.lastsHours ?? 24}
              onBlur={(event) => {
                const hours = Number(event.target.value);
                save({ lastsHours: hours > 0 && hours !== 24 ? hours : null });
              }}
              className={INPUT}
            />
          </label>
        </div>
        <CastField
          label="Caption (optional)"
          value={story.caption}
          canEdit={info.canEdit}
          onSave={(caption) => save({ caption: caption || null })}
        />
        {conditions.length > 1 && (
          <fieldset className="text-xs">
            <legend className="font-medium text-stone-600">
              Only in these conditions (none is all)
            </legend>
            <div className="mt-1 flex flex-wrap gap-3">
              {conditions.map((key) => (
                <SavedCheckbox
                  key={key}
                  checked={story.conditions.includes(key)}
                  disabled={!info.canEdit}
                  className="flex items-center gap-1"
                  onChange={(on) =>
                    save({
                      conditions: on
                        ? [...story.conditions, key]
                        : story.conditions.filter((item) => item !== key),
                    })
                  }
                >
                  {key}
                </SavedCheckbox>
              ))}
            </div>
          </fieldset>
        )}
        {problem && (
          <p role="alert" className="text-sm text-rose-700">
            {problem}
          </p>
        )}
        {info.canEdit && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => edits.remove.mutate(story.id)}
              className="rounded border border-stone-300 px-2 py-1 text-xs"
            >
              Delete this story
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

/** Stories someone in the cast posts. They freeze with a version, like posts. */
export function StoriesPage() {
  const { draftId } = useParams({ from: "/drafts/$draftId/stories" });
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
  const data = info.data;
  const sorted = [...data.stories].sort((a, b) => a.timeMs - b.timeMs);
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/drafts/$draftId" params={{ draftId }} className="text-sm underline">
          Back to the feed
        </Link>
        <h1 className="mr-auto text-lg font-semibold">Stories in {data.title}</h1>
        {data.canEdit && <SaveStatus draftId={draftId} />}
        {data.canEdit && (
          <button
            type="button"
            disabled={data.actors.length === 0 || edits.create.isPending}
            title={data.actors.length === 0 ? "Add someone to the cast first." : undefined}
            onClick={() => {
              setProblem(null);
              edits.create.mutate(
                {
                  kind: "story",
                  fields: { actorId: data.actors[0]?.id, timeMs: 0, conditions: [] },
                },
                { onError: (error) => setProblem(error.message) },
              );
            }}
            className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Add a story
          </button>
        )}
      </div>
      <p className="text-sm text-stone-500">
        A photo across the top of the feed, which lasts a set time. Participants can post their own.
        Who views theirs is written as a reaction, on their nth story.
      </p>
      {problem && (
        <p role="alert" className="text-sm text-rose-700">
          {problem}
        </p>
      )}
      {sorted.length === 0 && (
        <p className="rounded-lg bg-white p-6 text-center text-stone-500">No stories yet.</p>
      )}
      <ul className="space-y-3">
        {sorted.map((story) => (
          <StoryCard key={story.id} story={story} info={data} edits={edits} />
        ))}
      </ul>
    </div>
  );
}
