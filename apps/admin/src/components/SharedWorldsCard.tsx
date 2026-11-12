import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { shortTime } from "@truman3/ui";
import { useState } from "react";
import { get, post } from "../api.ts";

/** How often what's being written is checked, to watch it as it happens. */
const WATCH_EVERY_MS = 5_000;

interface Watched {
  worlds: { id: string; condition: string; people: number; startedAt: string }[];
  content: {
    id: string;
    worldId: string;
    kind: "post" | "comment" | "story" | "message";
    author: string;
    body: string;
    at: string;
    removed: boolean;
  }[];
  moderator: string | null;
}

const KIND = { post: "Post", comment: "Comment", story: "Story", message: "Message" };

/**
 * What participants are writing in shared worlds, newest first, with Remove for anything that
 * shouldn't stay up (ADR 68). A removal is the study's moderator's, so it looks like any other.
 */
export function SharedWorldsCard({ studyId, canEdit }: { studyId: string; canEdit: boolean }) {
  const client = useQueryClient();
  const watched = useQuery({
    queryKey: ["live", studyId],
    queryFn: () => get<Watched>(`/admin/studies/${studyId}/live`),
    refetchInterval: WATCH_EVERY_MS,
  });
  const [removing, setRemoving] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const remove = useMutation({
    mutationFn: (contentId: string) =>
      post(`/admin/studies/${studyId}/live/${contentId}/remove`, reason ? { reason } : {}),
    onSuccess: async () => {
      setRemoving(null);
      setReason("");
      await client.invalidateQueries({ queryKey: ["live", studyId] });
    },
  });

  if (!watched.data || watched.data.worlds.length === 0) {
    return null;
  }
  const { worlds, content, moderator } = watched.data;
  const worldNumber = new Map(worlds.map(({ id }, index) => [id, worlds.length - index]));

  return (
    <section aria-label="Shared worlds" className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
      <h2 className="font-semibold">Shared worlds</h2>
      <p className="text-sm text-stone-600">
        {worlds.length} {worlds.length === 1 ? "world" : "worlds"}, with{" "}
        {worlds.reduce((sum, { people }) => sum + people, 0)} people in all. What participants write
        appears here as it happens.
        {canEdit &&
          (moderator
            ? ` Removing something takes it down for everyone, as ${moderator}.`
            : ' To remove things, tick "Show a moderator tag on their name" for someone on the Cast page.')}
      </p>
      {content.length === 0 ? (
        <p className="text-sm text-stone-500">Nobody has written anything yet.</p>
      ) : (
        <ul className="divide-y divide-stone-100 text-sm" data-testid="live-content">
          {content.map((item) => (
            <li key={item.id} className="space-y-1 py-2">
              <p className="text-xs text-stone-500">
                {KIND[item.kind]} by {item.author} in world {worldNumber.get(item.worldId)},{" "}
                {shortTime(item.at)}
              </p>
              <p
                className={`break-words whitespace-pre-wrap ${item.removed ? "text-stone-400 line-through" : ""}`}
              >
                {item.body}
              </p>
              {item.removed ? (
                <p className="text-xs text-stone-500">Removed</p>
              ) : (
                canEdit &&
                moderator &&
                (removing === item.id ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      remove.mutate(item.id);
                    }}
                  >
                    <label className="flex items-center gap-2 text-xs">
                      Reason others see (optional)
                      <input
                        value={reason}
                        maxLength={200}
                        onChange={(event) => setReason(event.target.value)}
                        className="rounded border border-stone-300 px-2 py-1"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={remove.isPending}
                      className="rounded bg-rose-700 px-2 py-1 text-xs font-medium text-white"
                    >
                      Remove for everyone
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoving(null)}
                      className="text-xs underline"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      remove.reset();
                      setRemoving(item.id);
                    }}
                    className="text-xs text-rose-700 underline"
                  >
                    Remove
                  </button>
                ))
              )}
            </li>
          ))}
        </ul>
      )}
      {remove.error && (
        <p role="alert" className="text-sm text-rose-700">
          {remove.error.message}
        </p>
      )}
    </section>
  );
}
