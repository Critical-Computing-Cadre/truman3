import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { formatStudyTime, parseStudyTime } from "@truman3/core";
import { FeedPostView } from "@truman3/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type DraftInfo,
  type DraftItemDetails,
  type DraftPreviewResponse,
  get,
  post,
  send,
  upload,
} from "../api.ts";
import { TimelineControls, useTimeline } from "../components/TimelineControls.tsx";

/** Everything that changes a draft goes through here, and then redraws what depends on it. */
function useDraftEdits(draftId: string) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ["draft", draftId] });
  const base = `/admin/drafts/${draftId}/items`;

  return {
    update: useMutation({
      mutationFn: ({ itemId, changes }: { itemId: string; changes: object }) =>
        send("PATCH", `${base}/${itemId}`, { changes }),
      onSettled: refresh,
    }),
    create: useMutation({
      mutationFn: (body: { kind: "post" | "comment"; fields: object }) => send("POST", base, body),
      onSettled: refresh,
    }),
    remove: useMutation({
      mutationFn: (itemId: string) => send("DELETE", `${base}/${itemId}`),
      onSettled: refresh,
    }),
    setImage: useMutation({
      mutationFn: async ({ itemId, file }: { itemId: string; file: File }) => {
        const form = new FormData();
        form.append("image", file);
        const { picture } = await upload<{ picture: string }>(
          `/admin/drafts/${draftId}/images`,
          form,
        );
        return send("PATCH", `${base}/${itemId}`, { changes: { picture } });
      },
      onSettled: refresh,
    }),
  };
}

type DraftEdits = ReturnType<typeof useDraftEdits>;

/** Text you click to change, where it appears. It saves when you click away. */
function EditableText({
  value,
  label,
  required,
  onSave,
}: {
  value: string;
  label: string;
  required: boolean;
  onSave: (text: string) => void;
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
        onClick={() => setEditing(true)}
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
  edits,
}: {
  itemId: string;
  image: React.ReactNode;
  edits: DraftEdits;
}) {
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const addPhoto = (file: File | undefined) => {
    if (!file) {
      return;
    }
    setProblem(null);
    edits.setImage.mutate({ itemId, file }, { onError: (error) => setProblem(error.message) });
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
        addPhoto(event.dataTransfer.files[0]);
      }}
      className={`group relative ${over ? "outline-4 -outline-offset-4 outline-amber-400" : ""}`}
    >
      {image ?? (
        <div className="m-3 mb-0 flex flex-col items-center gap-1 rounded border-2 border-dashed border-stone-300 p-5 text-sm text-stone-500">
          <span>{saving ? "Adding the photo..." : "Drop a photo here"}</span>
          <button type="button" onClick={() => input.current?.click()} className="underline">
            or choose one
          </button>
        </div>
      )}
      {image && (
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="rounded bg-white/90 px-2 py-1 text-xs shadow"
          >
            {saving ? "Replacing..." : "Replace photo"}
          </button>
          <button
            type="button"
            onClick={() => edits.update.mutate({ itemId, changes: { picture: null } })}
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
      change({ timeMs: parsed });
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
  info,
  elapsedMs,
  postTimeMs,
  edits,
}: {
  postId: string;
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
        aria-label="Comment written by"
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
        aria-label="Add a comment"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Add a comment..."
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

/** The feed in one condition, where anything can be clicked and changed. */
function EditableFeed({
  draftId,
  info,
  condition,
  elapsedMs,
  edits,
}: {
  draftId: string;
  info: DraftInfo;
  condition: string;
  elapsedMs: number;
  edits: DraftEdits;
}) {
  const feed = useQuery({
    queryKey: ["draft", draftId, "feed", condition, elapsedMs],
    queryFn: () =>
      get<DraftPreviewResponse>(
        `/admin/drafts/${draftId}/preview?condition=${encodeURIComponent(condition)}&elapsedMs=${elapsedMs}`,
      ),
    placeholderData: keepPreviousData,
  });

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
    return (
      <div>
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
        {info.canEdit && (
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
        <FeedPostView
          key={shown.id}
          post={shown}
          renderNote={note}
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
                  />
                ),
                wrapImage: (image: React.ReactNode) => (
                  <ImageDrop itemId={shown.id} image={image} edits={edits} />
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
      ))}
    </section>
  );
}

/** Saving keeps a version to try out. Participants don't get it until it's launched. */
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
      await client.invalidateQueries({ queryKey: ["studies"] });
      await navigate({ to: "/" });
    },
  });

  const errors = info.issues.filter(({ severity }) => severity === "error");

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
              disabled={freeze.isPending}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Save version
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

  if (!info.data) {
    return null;
  }

  const current = timeline.condition ?? info.data.conditions[0]?.key ?? "";
  const failure = edits.update.error ?? edits.create.error ?? edits.remove.error;
  const issues = info.data.issues.filter(({ severity }) => severity === "error");

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
        extra={info.data.canEdit && <SaveVersion draftId={draftId} info={info.data} />}
      />

      <div className="mx-auto max-w-5xl px-3 pt-3 text-sm">
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
      </div>

      <div className="mx-auto flex max-w-5xl items-start justify-center gap-4 p-3">
        <EditableFeed
          draftId={draftId}
          info={info.data}
          condition={current}
          elapsedMs={timeline.shownElapsedMs}
          edits={edits}
        />
        {timeline.compare && timeline.compare !== current && (
          <EditableFeed
            draftId={draftId}
            info={info.data}
            condition={timeline.compare}
            elapsedMs={timeline.shownElapsedMs}
            edits={edits}
          />
        )}
      </div>
    </div>
  );
}
