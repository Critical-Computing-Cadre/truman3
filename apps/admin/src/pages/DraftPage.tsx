import {
  keepPreviousData,
  useIsMutating,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { formatStudyTime, MAX_ATTACHMENTS, parseStudyTime } from "@truman3/core";
import { FeedPostView, PlatformProvider, shortTime } from "@truman3/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type DraftChange,
  type DraftInfo,
  type DraftItemDetails,
  type DraftPreviewResponse,
  get,
  type Presence,
  post,
  send,
  upload,
} from "../api.ts";
import { PostTimeline } from "../components/PostTimeline.tsx";
import { TimelineControls, useTimeline } from "../components/TimelineControls.tsx";

/** Marks an edit to a draft, so the page can tell when one is still on its way. */
const draftEditKey = (draftId: string) => ["draft-edit", draftId];

/** Everything that changes a draft goes through here, and then redraws what depends on it. */
export function useDraftEdits(draftId: string) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ["draft", draftId] });
  const base = `/admin/drafts/${draftId}/items`;
  const mutationKey = draftEditKey(draftId);

  return {
    update: useMutation({
      mutationKey,
      mutationFn: ({ itemId, changes }: { itemId: string; changes: object }) =>
        send("PATCH", `${base}/${itemId}`, { changes }),
      onSettled: refresh,
    }),
    create: useMutation({
      mutationKey,
      mutationFn: (body: { kind: "post" | "comment" | "actor" | "space"; fields: object }) =>
        send("POST", base, body),
      onSettled: refresh,
    }),
    move: useMutation({
      mutationKey,
      mutationFn: ({ itemId, timeMs }: { itemId: string; timeMs: number }) =>
        send("POST", `${base}/${itemId}/move`, { timeMs }),
      onSettled: refresh,
    }),
    remove: useMutation({
      mutationKey,
      mutationFn: (itemId: string) => send("DELETE", `${base}/${itemId}`),
      onSettled: refresh,
    }),
    /** A person's picture in the cast. */
    setActorPicture: useMutation({
      mutationKey,
      mutationFn: async ({
        itemId,
        file,
        field = "picture",
      }: {
        itemId: string;
        file: File;
        /** Which of an item's images this is: its picture, or a space's banner. */
        field?: "picture" | "banner";
      }) => {
        const form = new FormData();
        form.append("image", file);
        const { picture } = await upload<{ picture: string }>(
          `/admin/drafts/${draftId}/images`,
          form,
        );
        return send("PATCH", `${base}/${itemId}`, { changes: { [field]: picture } });
      },
      onSettled: refresh,
    }),
    setImage: useMutation({
      mutationKey,
      /** Replaces the first photo, or with `add`, goes after the ones there already. */
      mutationFn: async ({
        itemId,
        file,
        current,
        add,
      }: {
        itemId: string;
        file: File;
        current: string[];
        add: boolean;
      }) => {
        const form = new FormData();
        form.append("image", file);
        const { picture } = await upload<{ picture: string }>(
          `/admin/drafts/${draftId}/images`,
          form,
        );
        const pictures = add ? [...current, picture] : [picture, ...current.slice(1)];
        return send("PATCH", `${base}/${itemId}`, { changes: { pictures } });
      },
      onSettled: refresh,
    }),
  };
}

export type DraftEdits = ReturnType<typeof useDraftEdits>;

/**
 * Says whether edits have reached the server. Each one saves by itself, with no button, so nothing
 * else on the screen shows that. Text saves when someone clicks away from it, which is `editing`.
 */
export function SaveStatus({ draftId, editing = false }: { draftId: string; editing?: boolean }) {
  const mutationKey = draftEditKey(draftId);
  const saving = useIsMutating({ mutationKey }) > 0;
  const last = useMutationState({
    filters: { mutationKey },
    select: ({ state }) => state.status,
  }).at(-1);

  let text = "Changes save as you go";
  if (saving) {
    text = "Saving...";
  } else if (editing) {
    text = "Saves when you click away";
  } else if (last === "error") {
    text = "Your last change didn't save";
  } else if (last === "success") {
    text = "All changes saved";
  }

  return (
    <span
      role="status"
      data-testid="save-status"
      className={`text-xs ${last === "error" && !saving && !editing ? "text-rose-700" : "text-stone-500"}`}
    >
      {text}
    </span>
  );
}

const PRESENCE_EVERY_MS = 2_000;

/**
 * Keeps a draft in step with whoever else is working on it. It checks every couple of seconds, and
 * redraws when anything has changed. What someone is typing stays put, since that's held locally.
 */
export function useDraftPresence(
  draftId: string,
  editingItemId: string | null,
  editingSection: string | null = null,
) {
  const client = useQueryClient();
  const [others, setOthers] = useState<Presence["others"]>([]);
  const lastChange = useRef<number | null>(null);
  const editing = useRef(editingItemId);
  editing.current = editingItemId;
  const section = useRef(editingSection);
  section.current = editingSection;

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const presence = await post<Presence>(`/admin/drafts/${draftId}/presence`, {
          itemId: editing.current,
          section: section.current,
        });
        if (cancelled) {
          return;
        }
        setOthers(presence.others);
        if (lastChange.current !== null && lastChange.current !== presence.latestChange) {
          client.invalidateQueries({ queryKey: ["draft", draftId] });
        }
        lastChange.current = presence.latestChange;
      } catch {
        // A missed check is fine. The next one catches up.
      }
    };

    check();
    const timer = setInterval(check, PRESENCE_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [draftId, client]);

  // Tell others right away when starting to edit, rather than at the next check.
  useEffect(() => {
    if (editingItemId) {
      post(`/admin/drafts/${draftId}/presence`, { itemId: editingItemId }).catch(() => {});
    }
  }, [draftId, editingItemId]);

  return others;
}

/** Recent changes, with who made them, and undo. */
export function RecentChanges({ draftId, canEdit }: { draftId: string; canEdit: boolean }) {
  const client = useQueryClient();
  const changes = useQuery({
    queryKey: ["draft", draftId, "changes"],
    queryFn: () => get<{ changes: DraftChange[] }>(`/admin/drafts/${draftId}/changes`),
  });
  const undo = useMutation({
    mutationFn: (changeId: string) => post(`/admin/drafts/${draftId}/changes/${changeId}/undo`),
    onSettled: () => client.invalidateQueries({ queryKey: ["draft", draftId] }),
  });

  const list = changes.data?.changes ?? [];

  return (
    <details className="mb-2 text-xs">
      <summary className="cursor-pointer select-none">
        Recent changes{list.length > 0 ? ` (${list.length})` : ""}
      </summary>
      {undo.error && (
        <p role="alert" className="mt-1 rounded bg-rose-100 p-2 text-rose-900">
          {undo.error.message}
        </p>
      )}
      {list.length === 0 && <p className="mt-1 text-stone-500">Nothing yet.</p>}
      <ul className="mt-1 max-h-48 divide-y divide-stone-200 overflow-y-auto">
        {list.map((change) => (
          <li key={change.changeId} className="flex items-center gap-2 py-1">
            <span className="min-w-0 flex-1 truncate">
              <strong>{change.mine ? "You" : change.who}</strong> {change.summary}
            </span>
            <span className="text-stone-500">{shortTime(change.at)}</span>
            {canEdit && change.canUndo && (
              <button
                type="button"
                disabled={undo.isPending}
                onClick={() => undo.mutate(change.changeId)}
                className="underline"
              >
                Undo
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Text you click to change, where it appears. It saves when you click away. */
function EditableText({
  value,
  label,
  required,
  onSave,
  onEditing,
}: {
  value: string;
  label: string;
  required: boolean;
  onSave: (text: string) => void;
  /** Says when someone starts and stops, so others can see. */
  onEditing: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      box.current?.focus();
    } else {
      setDraft(value);
    }
  }, [editing, value]);

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={`${label}: ${value || "empty"}`}
        onClick={() => {
          setEditing(true);
          onEditing(true);
        }}
        className="block w-full cursor-text rounded text-left break-words whitespace-pre-wrap hover:bg-amber-50 hover:outline hover:outline-amber-300"
      >
        {value || <span className="text-stone-400">Click to write something</span>}
      </button>
    );
  }

  const finish = () => {
    const text = draft.trim();
    if (text !== value && (text || !required)) {
      onSave(text);
    }
    setEditing(false);
    onEditing(false);
  };

  return (
    <textarea
      ref={box}
      aria-label={label}
      value={draft}
      rows={Math.max(2, draft.split("\n").length)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setDraft(value);
          setEditing(false);
          onEditing(false);
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.currentTarget.blur();
        }
      }}
      className="block w-full rounded border border-amber-400 px-1 outline-none"
    />
  );
}

/**
 * Where a post's image goes. Drop a photo on it, or choose one. There are no filenames, so a post
 * can't end up pointing at a picture that isn't there.
 */
function ImageDrop({
  itemId,
  image,
  pictures,
  several,
  edits,
}: {
  itemId: string;
  image: React.ReactNode;
  pictures: string[];
  /** Whether this platform lets a post have several photos. */
  several: boolean;
  edits: DraftEdits;
}) {
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const adding = useRef(false);

  const addPhoto = (file: File | undefined, add = adding.current) => {
    if (!file) {
      return;
    }
    setProblem(null);
    edits.setImage.mutate(
      { itemId, file, current: pictures, add },
      { onError: (error) => setProblem(error.message) },
    );
  };
  const choose = (add: boolean) => {
    adding.current = add;
    input.current?.click();
  };

  const saving = edits.setImage.isPending && edits.setImage.variables?.itemId === itemId;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dropping is an extra; the buttons do the same
    <div
      data-testid="image-drop"
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        addPhoto(event.dataTransfer.files[0], several && pictures.length > 0);
      }}
      className={`group relative ${over ? "outline-4 -outline-offset-4 outline-amber-400" : ""}`}
    >
      {image ?? (
        <div className="m-3 mb-0 flex flex-col items-center gap-1 rounded border-2 border-dashed border-stone-300 p-5 text-sm text-stone-500">
          <span>{saving ? "Adding the photo..." : "Drop a photo here"}</span>
          <button type="button" onClick={() => choose(false)} className="underline">
            or choose one
          </button>
        </div>
      )}
      {image && (
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          {several && pictures.length < MAX_ATTACHMENTS && (
            <button
              type="button"
              onClick={() => choose(true)}
              className="rounded bg-white/90 px-2 py-1 text-xs shadow"
            >
              Add another photo
            </button>
          )}
          <button
            type="button"
            onClick={() => choose(false)}
            className="rounded bg-white/90 px-2 py-1 text-xs shadow"
          >
            {saving ? "Replacing..." : "Replace photo"}
          </button>
          <button
            type="button"
            onClick={() =>
              edits.update.mutate({ itemId, changes: { pictures: pictures.slice(1) } })
            }
            className="rounded bg-white/90 px-2 py-1 text-xs shadow"
          >
            Remove photo
          </button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        aria-label="Choose a photo"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          addPhoto(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {problem && (
        <p role="alert" className="mx-3 mt-2 text-sm text-rose-800">
          {problem}
        </p>
      )}
    </div>
  );
}

/** Who wrote it, when it appears, and who sees it, under each post and comment. */
function ItemDetails({
  itemId,
  details,
  info,
  kind,
  edits,
}: {
  itemId: string;
  details: DraftItemDetails;
  info: DraftInfo;
  kind: "post" | "comment";
  edits: DraftEdits;
}) {
  const [time, setTime] = useState(formatStudyTime(details.timeMs));
  const [timeProblem, setTimeProblem] = useState(false);
  // Shown right away, rather than waiting for the save to come back and flipping in the meantime.
  const [actorId, setActorId] = useState(details.actorId);
  const [conditions, setConditions] = useState(details.conditions);

  useEffect(() => {
    setActorId(details.actorId);
    setConditions(details.conditions);
  }, [details.actorId, details.conditions]);

  useEffect(() => {
    setTime(formatStudyTime(details.timeMs));
    setTimeProblem(false);
  }, [details.timeMs]);

  const change = (changes: object) => edits.update.mutate({ itemId, changes });

  const saveTime = () => {
    const parsed = parseStudyTime(time);
    if (parsed === null) {
      setTimeProblem(true);
    } else if (parsed !== details.timeMs) {
      // A post takes its comments with it, the same as dragging it on the timeline.
      if (kind === "post") {
        edits.move.mutate({ itemId, timeMs: parsed });
      } else {
        change({ timeMs: parsed });
      }
    }
  };

  const toggleCondition = (key: string, on: boolean) => {
    const next = on ? [...conditions, key] : conditions.filter((item) => item !== key);
    setConditions(next);
    change({ conditions: next });
  };

  const field = "rounded border border-stone-300 bg-white px-1.5 py-0.5";

  return (
    <details className="mt-1 text-xs text-stone-600">
      <summary className="cursor-pointer select-none">Details</summary>
      <div className="mt-2 space-y-2 rounded bg-stone-50 p-2">
        <label className="flex items-center gap-2">
          Written by
          <select
            value={actorId}
            onChange={(event) => {
              setActorId(event.target.value);
              change({ actorId: event.target.value });
            }}
            className={`${field} min-w-0 flex-1`}
          >
            {info.actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Appears at
          <input
            value={time}
            onChange={(event) => {
              setTime(event.target.value);
              setTimeProblem(false);
            }}
            onBlur={saveTime}
            className={`${field} w-20`}
          />
          <span className={timeProblem ? "text-rose-700" : ""}>
            {timeProblem ? "Use hours:minutes, like 2:05" : "hours:minutes from when they start"}
          </span>
        </label>
        <label className="flex items-center gap-2">
          Likes
          <input
            type="number"
            min={0}
            defaultValue={details.likes}
            onBlur={(event) => {
              const likes = Number(event.target.value);
              if (Number.isInteger(likes) && likes >= 0 && likes !== details.likes) {
                change({ likes });
              }
            }}
            className={`${field} w-20`}
          />
        </label>
        {kind === "post" && info.conditions.some(({ features }) => features.spaces) && (
          <label className="flex items-center gap-2">
            Space
            <select
              value={details.spaceId ?? ""}
              onChange={(event) => change({ spaceId: event.target.value || null })}
              className={field}
            >
              <option value="">None</option>
              {info.spaces.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        {info.conditions.some(({ features }) => features.votes) &&
          (["ups", "downs"] as const).map((key) => (
            <label key={key} className="flex items-center gap-2">
              {key === "ups" ? "Up votes" : "Down votes"}
              <input
                type="number"
                min={0}
                defaultValue={details[key]}
                onBlur={(event) => {
                  const count = Number(event.target.value);
                  if (Number.isInteger(count) && count >= 0 && count !== details[key]) {
                    change({ [key]: count });
                  }
                }}
                className={`${field} w-20`}
              />
            </label>
          ))}
        <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <legend className="float-left mr-2">Shown in</legend>
          {info.conditions.map(({ key }) => (
            <label key={key} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={conditions.includes(key)}
                onChange={(event) => toggleCondition(key, event.target.checked)}
              />
              {key}
            </label>
          ))}
          <span>{conditions.length === 0 ? "(none ticked means all)" : ""}</span>
        </fieldset>
        <button
          type="button"
          onClick={() => edits.remove.mutate(itemId)}
          className="text-rose-700 underline"
        >
          Delete this {kind}
        </button>
      </div>
    </details>
  );
}

function AddComment({
  postId,
  replyToId,
  info,
  elapsedMs,
  postTimeMs,
  edits,
}: {
  postId: string;
  /** Makes this a reply to that comment. */
  replyToId?: string;
  info: DraftInfo;
  elapsedMs: number;
  postTimeMs: number;
  edits: DraftEdits;
}) {
  const [body, setBody] = useState("");
  const [actorId, setActorId] = useState(info.actors[0]?.id ?? "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (body.trim()) {
      edits.create.mutate({
        kind: "comment",
        fields: {
          body: body.trim(),
          actorId,
          postId,
          ...(replyToId ? { replyToId } : {}),
          timeMs: Math.max(elapsedMs, postTimeMs),
          conditions: [],
        },
      });
      setBody("");
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2 text-sm">
      <select
        aria-label={replyToId ? "Reply written by" : "Comment written by"}
        value={actorId}
        onChange={(event) => setActorId(event.target.value)}
        className="max-w-32 rounded border border-stone-300 bg-white px-1"
      >
        {info.actors.map((actor) => (
          <option key={actor.id} value={actor.id}>
            {actor.name}
          </option>
        ))}
      </select>
      <input
        aria-label={replyToId ? "Add a reply" : "Add a comment"}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={replyToId ? "Add a reply..." : "Add a comment..."}
        className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-1"
      />
      <button
        type="submit"
        disabled={!body.trim()}
        className="rounded bg-stone-900 px-3 py-1 text-white disabled:opacity-40"
      >
        Add
      </button>
    </form>
  );
}

const SCROLL_CORRECTIONS_MS = [250, 700, 1500];

/** The feed in one condition, where anything can be clicked and changed. */
function EditableFeed({
  draftId,
  info,
  condition,
  elapsedMs,
  edits,
  highlightId,
  others,
  onEditingItem,
}: {
  draftId: string;
  info: DraftInfo;
  condition: string;
  elapsedMs: number;
  edits: DraftEdits;
  /** A post chosen on the timeline, to bring into view. */
  highlightId?: string | null;
  /** Who else is here, to show on what they're editing. */
  others: Presence["others"];
  onEditingItem: (itemId: string | null) => void;
}) {
  const feed = useQuery({
    queryKey: ["draft", draftId, "feed", condition, elapsedMs],
    queryFn: () =>
      get<DraftPreviewResponse>(
        `/admin/drafts/${draftId}/preview?condition=${encodeURIComponent(condition)}&elapsedMs=${elapsedMs}`,
      ),
    placeholderData: keepPreviousData,
  });

  const shownIds = feed.data?.posts.map(({ id }) => id).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs again once the post has loaded
  useEffect(() => {
    if (!highlightId) {
      return;
    }
    const bringIntoView = () =>
      document.querySelector(`[data-post="${highlightId}"]`)?.scrollIntoView({ block: "center" });

    // Photos above it load as the page moves, which pushes it down, so this corrects for them.
    bringIntoView();
    const timers = SCROLL_CORRECTIONS_MS.map((delay) => setTimeout(bringIntoView, delay));
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [highlightId, shownIds]);

  const items = feed.data?.items ?? {};
  const kinds = new Map<string, "post" | "comment">();
  for (const shown of feed.data?.posts ?? []) {
    kinds.set(shown.id, "post");
    for (const comment of shown.comments) {
      kinds.set(comment.id, "comment");
    }
  }

  const note = (contentId: string) => {
    const details = items[contentId];
    if (!details) {
      return null;
    }
    const editors = others.filter(({ itemId }) => itemId === contentId);
    return (
      <div>
        {editors.length > 0 && (
          <p className="mt-1 mr-1 inline-block rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-900">
            {editors.map(({ name }) => name).join(", ")} editing this
          </p>
        )}
        {details.conditions.length > 0 && (
          <p className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
            Only in {details.conditions.join(", ")}
          </p>
        )}
        {info.canEdit && (
          <ItemDetails
            itemId={contentId}
            details={details}
            info={info}
            kind={kinds.get(contentId) ?? "post"}
            edits={edits}
          />
        )}
      </div>
    );
  };

  const addPost = () =>
    edits.create.mutate({
      kind: "post",
      fields: { body: "", actorId: info.actors[0]?.id, timeMs: elapsedMs, conditions: [] },
    });

  return (
    <section
      aria-label={`Feed in ${condition}`}
      className="w-full max-w-md min-w-0 flex-1 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          {condition}{" "}
          <span className="font-normal text-stone-500">({feed.data?.posts.length ?? 0} posts)</span>
        </h2>
        {info.canEdit && info.actors.length === 0 && (
          <Link
            to="/drafts/$draftId/cast"
            params={{ draftId }}
            className="rounded border border-stone-300 bg-white px-3 py-1 text-sm"
          >
            Add someone to the cast first
          </Link>
        )}
        {info.canEdit && info.actors.length > 0 && (
          <button
            type="button"
            onClick={addPost}
            disabled={edits.create.isPending}
            className="rounded border border-stone-300 bg-white px-3 py-1 text-sm disabled:opacity-40"
          >
            New post here
          </button>
        )}
      </div>
      {feed.data?.posts.length === 0 && (
        <p className="rounded-lg bg-white p-6 text-center text-stone-500">No posts to show.</p>
      )}
      {feed.data?.posts.map((shown) => (
        <div
          key={shown.id}
          data-post={shown.id}
          className={highlightId === shown.id ? "rounded-lg ring-2 ring-sky-500" : ""}
        >
          <PlatformProvider platform={info.conditions.find(({ key }) => key === condition)}>
            <FeedPostView
              post={shown}
              renderNote={(contentId) => (
                <>
                  {note(contentId)}
                  {info.canEdit &&
                    kinds.get(contentId) === "comment" &&
                    info.conditions.find(({ key }) => key === condition)?.features.threads && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-stone-500">Add a reply</summary>
                        <div className="mt-1">
                          <AddComment
                            postId={shown.id}
                            replyToId={contentId}
                            info={info}
                            elapsedMs={elapsedMs}
                            postTimeMs={items[contentId]?.timeMs ?? 0}
                            edits={edits}
                          />
                        </div>
                      </details>
                    )}
                </>
              )}
              {...(info.canEdit
                ? {
                    renderBody: (contentId: string, body: string) => (
                      <EditableText
                        value={body}
                        required={kinds.get(contentId) === "comment"}
                        label={`Text of this ${kinds.get(contentId) ?? "post"}`}
                        onSave={(text) =>
                          edits.update.mutate({ itemId: contentId, changes: { body: text } })
                        }
                        onEditing={(editing) => onEditingItem(editing ? contentId : null)}
                      />
                    ),
                    renderTitle: (contentId: string, title: string) => (
                      <EditableText
                        value={title}
                        required={false}
                        label="Title of this post"
                        onSave={(text) =>
                          edits.update.mutate({
                            itemId: contentId,
                            changes: { title: text || null },
                          })
                        }
                        onEditing={(editing) => onEditingItem(editing ? contentId : null)}
                      />
                    ),
                    wrapImage: (image: React.ReactNode) => (
                      <ImageDrop
                        itemId={shown.id}
                        image={image}
                        pictures={items[shown.id]?.pictures ?? []}
                        several={
                          info.conditions.find(({ key }) => key === condition)?.features
                            .galleries ?? false
                        }
                        edits={edits}
                      />
                    ),
                    belowComments: (
                      <AddComment
                        postId={shown.id}
                        info={info}
                        elapsedMs={elapsedMs}
                        postTimeMs={items[shown.id]?.timeMs ?? 0}
                        edits={edits}
                      />
                    ),
                  }
                : {})}
            />
          </PlatformProvider>
        </div>
      ))}
    </section>
  );
}

/** Saving keeps a version to try out. Participants don't get it until it's launched. */
/** Saves what's in this draft as a pack, so the team can start other studies from it. */
function SavePack({ draftId, defaultName }: { draftId: string; defaultName: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");

  const save = useMutation({
    mutationFn: () =>
      post<{ status: "saved" | "exists"; name: string }>(`/admin/drafts/${draftId}/pack`, {
        name,
        description,
      }),
  });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          save.reset();
          dialog.current?.showModal();
        }}
        className="rounded border border-stone-300 px-3 py-1.5 text-sm"
      >
        Save as a pack
      </button>
      <dialog
        ref={dialog}
        aria-label="Save as a pack"
        className="m-auto w-[min(92vw,28rem)] rounded-lg p-4 backdrop:bg-black/50"
      >
        <h2 className="mb-2 text-lg font-semibold">Save as a pack</h2>
        {save.data ? (
          <>
            <p className="mb-3 text-sm">
              {save.data.status === "saved"
                ? `Saved "${save.data.name}". Your team can start new studies from it.`
                : `This is the same as "${save.data.name}", which is already saved.`}
            </p>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white"
            >
              Done
            </button>
          </>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <p className="text-sm text-stone-600">
              This copies the people, posts, and comments as they are now, so your team can start
              other studies from them. Your consent text and study flow stay out of it. Later
              changes here won't change the pack.
            </p>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Name
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded border border-stone-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Description
              <textarea
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="rounded border border-stone-300 px-2 py-1.5 text-sm"
              />
            </label>
            {save.error && (
              <p role="alert" className="text-sm text-rose-700">
                {save.error.message}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={save.isPending || !name.trim()}
                className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
              >
                Save the pack
              </button>
              <button
                type="button"
                onClick={() => dialog.current?.close()}
                className="rounded border border-stone-300 px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}

function SaveVersion({ draftId, info }: { draftId: string; info: DraftInfo }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const freeze = useMutation({
    mutationFn: () =>
      post<{ status: "frozen" | "unchanged"; version: number }>(`/admin/drafts/${draftId}/freeze`),
    onSuccess: async ({ status, version }) => {
      if (status === "unchanged") {
        setMessage(`You haven't changed anything yet, so this is still version ${version}.`);
        return;
      }
      dialog.current?.close();
      // Dropped rather than refreshed, or the list would first show its old versions, and the
      // Launch buttons would move just as someone reaches for one.
      client.removeQueries({ queryKey: ["studies"] });
      await navigate({ to: "/" });
    },
  });

  const errors = info.issues.filter(({ severity }) => severity === "error");
  // A version copies what's saved, so an edit still on its way wouldn't be in it.
  const stillSaving = useIsMutating({ mutationKey: draftEditKey(draftId) }) > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMessage(null);
          freeze.reset();
          dialog.current?.showModal();
        }}
        className="rounded bg-emerald-700 px-3 py-1 text-sm text-white"
      >
        Save as new version
      </button>
      <dialog
        ref={dialog}
        aria-label="Save as new version"
        className="m-auto w-[min(90vw,30rem)] rounded-lg p-6 backdrop:bg-black/50"
      >
        <h2 className="mb-2 text-lg font-semibold">Save as a new version?</h2>
        {errors.length > 0 ? (
          <>
            <p className="mb-2">These need fixing first:</p>
            <ul className="mb-4 list-disc pl-5 text-sm text-rose-800">
              {errors.map(({ message: text }) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </>
        ) : (
          <ul className="mb-4 list-disc space-y-1 pl-5 text-sm">
            <li>Your edits are already saved in this draft. This makes a copy you can launch.</li>
            <li>
              <strong>Participants won't see it yet.</strong> You can try it out first, then launch
              it from the studies page.
            </li>
            <li>A saved version can't be changed, only replaced by another new version.</li>
          </ul>
        )}
        {message && <p className="mb-4 text-sm">{message}</p>}
        {freeze.error && (
          <p role="alert" className="mb-4 text-sm text-rose-800">
            {freeze.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="rounded border border-stone-300 px-3 py-1.5 text-sm"
          >
            Keep editing
          </button>
          {errors.length === 0 && (
            <button
              type="button"
              onClick={() => freeze.mutate()}
              disabled={freeze.isPending || stillSaving}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              {stillSaving ? "Waiting for your last change..." : "Save version"}
            </button>
          )}
        </div>
      </dialog>
    </>
  );
}

export function DraftPage() {
  const { draftId } = useParams({ from: "/drafts/$draftId" });
  const info = useQuery({
    queryKey: ["draft", draftId, "info"],
    queryFn: () => get<DraftInfo>(`/admin/drafts/${draftId}`),
  });
  const edits = useDraftEdits(draftId);
  const timeline = useTimeline(info.data?.lengthMs ?? 0);
  const [arranging, setArranging] = useState(true);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const others = useDraftPresence(draftId, editingItemId);

  if (!info.data) {
    return null;
  }

  const current = timeline.condition ?? info.data.conditions[0]?.key ?? "";
  const failure =
    edits.update.error ?? edits.create.error ?? edits.remove.error ?? edits.move.error;
  const windowHours = info.data.conditions.find(({ key }) => key === current)?.windowHours ?? null;
  const { lengthMs } = info.data;
  const issues = info.data.issues.filter(({ severity }) => severity === "error");
  const warnings = info.data.issues.filter(({ severity }) => severity === "warning");

  return (
    <div>
      <TimelineControls
        title={
          <>
            {info.data.title}{" "}
            <span className="font-normal text-amber-700">
              {info.data.closed ? "saved" : "draft"}
            </span>
          </>
        }
        conditions={info.data.conditions}
        posts={info.data.posts}
        lengthMs={info.data.lengthMs}
        timeline={timeline}
        current={current}
        extra={
          <>
            {info.data.canEdit && <SaveStatus draftId={draftId} editing={editingItemId !== null} />}
            <Link
              to="/drafts/$draftId/settings"
              params={{ draftId }}
              className="rounded border border-stone-300 px-3 py-1.5 text-sm"
            >
              Settings
            </Link>
            <Link
              to="/drafts/$draftId/cast"
              params={{ draftId }}
              className="rounded border border-stone-300 px-3 py-1.5 text-sm"
            >
              Cast
            </Link>
            {info.data.conditions.some(({ features }) => features.spaces) && (
              <Link
                to="/drafts/$draftId/spaces"
                params={{ draftId }}
                className="rounded border border-stone-300 px-3 py-1.5 text-sm"
              >
                Spaces
              </Link>
            )}
            {info.data.canEdit && <SavePack draftId={draftId} defaultName={info.data.title} />}
            {info.data.canEdit && <SaveVersion draftId={draftId} info={info.data} />}
          </>
        }
      />

      {/* Not pinned with the controls above, or it would cover half the screen while reading the feed. */}
      <div className="border-b border-stone-200 bg-white px-3 pb-2">
        <div className="mx-auto max-w-5xl pt-2">
          {others.length > 0 && (
            <p className="mb-1 text-xs" data-testid="also-here">
              <span className="rounded bg-sky-100 px-2 py-0.5 text-sky-900">
                Also here: {others.map(({ name }) => name).join(", ")}
              </span>
            </p>
          )}
          <button
            type="button"
            aria-expanded={arranging}
            onClick={() => setArranging(!arranging)}
            className="text-xs underline"
          >
            {arranging ? "Hide posts on the timeline" : "Show posts on the timeline"}
          </button>
          {arranging && (
            <PostTimeline
              posts={info.data.posts}
              lengthMs={lengthMs}
              windowHours={windowHours}
              condition={current}
              elapsedMs={timeline.elapsedMs}
              canEdit={info.data.canEdit}
              onMove={(itemId, timeMs) => edits.move.mutate({ itemId, timeMs })}
              onSelect={(itemId, timeMs) => {
                timeline.setPlaying(false);
                timeline.setElapsedMs(Math.min(lengthMs, Math.max(0, timeMs)));
                setHighlightId(itemId);
              }}
            />
          )}
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-3 pt-3 text-sm">
        <RecentChanges draftId={draftId} canEdit={info.data.canEdit} />
        {info.data.closed && (
          <p className="rounded bg-stone-200 p-3">
            This draft has been saved as a version, so it can't be changed.{" "}
            <Link to="/" className="underline">
              Back to studies
            </Link>
          </p>
        )}
        {!info.data.canEdit && !info.data.closed && (
          <p className="rounded bg-stone-200 p-3">You can view this study, but not change it.</p>
        )}
        {failure && (
          <p role="alert" className="rounded bg-rose-100 p-3 text-rose-900">
            That change didn't save: {failure.message}
          </p>
        )}
        {issues.length > 0 && (
          <div className="rounded bg-rose-50 p-3 text-rose-900">
            <p className="font-medium">Fix before saving a version:</p>
            <ul className="list-disc pl-5">
              {issues.map(({ message }) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <details className="mt-2 rounded bg-amber-50 p-3 text-amber-900">
            <summary className="cursor-pointer font-medium">
              {warnings.length === 1 ? "1 thing" : `${warnings.length} things`} to check
            </summary>
            <ul className="mt-1 list-disc pl-5">
              {warnings.map(({ message }) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="mx-auto flex max-w-5xl items-start justify-center gap-4 p-3">
        <EditableFeed
          draftId={draftId}
          info={info.data}
          condition={current}
          elapsedMs={timeline.shownElapsedMs}
          edits={edits}
          highlightId={highlightId}
          others={others}
          onEditingItem={setEditingItemId}
        />
        {timeline.compare && timeline.compare !== current && (
          <EditableFeed
            draftId={draftId}
            info={info.data}
            condition={timeline.compare}
            elapsedMs={timeline.shownElapsedMs}
            edits={edits}
            others={others}
            onEditingItem={setEditingItemId}
          />
        )}
      </div>
    </div>
  );
}
