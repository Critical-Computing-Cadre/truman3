import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, send } from "../api.ts";

interface Day {
  id: string;
  condition: string;
  day: number;
  status: "writing" | "held" | "published" | "skipped" | "error";
  dropped: number;
  costUsd: number;
  error: string | null;
  posts: {
    index: number;
    removed: boolean;
    actor: string;
    title: string;
    body: string;
    minute: number;
    replies: { actor: string; body: string }[];
  }[];
}

interface Community {
  on: boolean;
  hold: boolean;
  daysBefore: number;
  daysDuring: number;
  budgetUsd: number;
  spentUsd: number;
  whyNot: string | null;
  days: Day[];
}

const STATUS: Record<Day["status"], string> = {
  writing: "Being written",
  held: "Waiting for you",
  published: "Published",
  skipped: "Skipped",
  error: "Failed, and will be tried again",
};

const dayName = (day: number) =>
  day < 0 ? `${-day} ${day === -1 ? "day" : "days"} before they arrive` : `Day ${day + 1}`;
const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/**
 * A live community as it's written (ADR 102): each day, newest first, with what the model wrote.
 * A held day is approved or skipped here, and any post can be taken back out. Nothing shows for a
 * study without one.
 */
export function CommunityCard({ studyId, canEdit }: { studyId: string; canEdit: boolean }) {
  const client = useQueryClient();
  const key = ["live-community", studyId];
  const state = useQuery({
    queryKey: key,
    queryFn: () => get<Community>(`/admin/studies/${studyId}/community`),
    refetchInterval: 15_000,
  });
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const decide = useMutation({
    mutationFn: ({ dayId, decision }: { dayId: string; decision: "approve" | "skip" }) =>
      post(`/admin/studies/${studyId}/community/days/${dayId}`, { decision }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: ({ dayId, index }: { dayId: string; index: number }) =>
      send("DELETE", `/admin/studies/${studyId}/community/days/${dayId}/posts/${index}`),
    onSettled: refresh,
  });

  const community = state.data;
  if (!community?.on) {
    return null;
  }
  const waiting = community.days.filter(({ status }) => status === "held").length;
  return (
    <section aria-label="Live community" className="card space-y-3 p-4">
      <div>
        <h2 className="text-lg font-semibold">Live community</h2>
        <p className="text-sm text-stone-600">
          A model writes this study's community a day ahead of whoever is furthest along.{" "}
          {community.hold
            ? "Each day waits here for you before anyone can see it."
            : "Nobody reads it first, so look over what's coming, and take out anything you don't want."}{" "}
          It has spent ${community.spentUsd.toFixed(2)} of the study's ${community.budgetUsd} budget
          for writing.
        </p>
      </div>
      {community.whyNot && (
        <p role="status" className="rounded bg-amber-50 p-2 text-sm text-amber-900">
          Nothing more is being written. {community.whyNot}
        </p>
      )}
      {waiting > 0 && (
        <p role="status" className="rounded bg-sky-50 p-2 text-sm text-sky-900">
          {waiting} {waiting === 1 ? "day is" : "days are"} waiting for you. Participants who reach
          a day that isn't approved see nothing from it.
        </p>
      )}
      {(decide.error ?? remove.error) && (
        <p role="alert" className="text-sm text-rose-800">
          {(decide.error ?? remove.error)?.message}
        </p>
      )}
      {community.days.length === 0 ? (
        <p className="text-sm text-stone-600">
          Nothing's been written yet. It starts when the study is launched.
        </p>
      ) : (
        <ul className="space-y-2">
          {community.days.map((day) => (
            <li key={day.id} className="rounded border border-stone-200">
              <details open={day.status === "held"}>
                <summary className="cursor-pointer px-3 py-2 text-sm">
                  <span className="font-medium">
                    {dayName(day.day)}
                    {day.condition && ` in “${day.condition}”`}
                  </span>
                  : {STATUS[day.status]}
                  {day.status !== "writing" &&
                    day.status !== "error" &&
                    `, ${day.posts.length} ${day.posts.length === 1 ? "post" : "posts"}`}
                  {day.dropped > 0 && `, ${day.dropped} left out by the check`}
                </summary>
                <div className="space-y-2 border-t border-stone-200 p-3">
                  {day.error && <p className="text-sm text-rose-800">{day.error}</p>}
                  {day.posts.map((item) => (
                    <div
                      key={item.index}
                      className={`rounded bg-stone-50 p-2 text-sm ${item.removed ? "opacity-50" : ""}`}
                    >
                      <p>
                        <span className="font-medium">@{item.actor}</span>{" "}
                        <span className="text-stone-500">{clock(item.minute)}</span>
                        {item.removed && <span className="ml-2 text-rose-800">Taken out</span>}
                      </p>
                      {item.title && <p className="font-medium">{item.title}</p>}
                      <p className="whitespace-pre-wrap">{item.body}</p>
                      {item.replies.map((reply, r) => (
                        <p
                          // biome-ignore lint/suspicious/noArrayIndexKey: replies never reorder
                          key={r}
                          className="mt-1 border-l-2 border-stone-300 pl-2 whitespace-pre-wrap"
                        >
                          <span className="font-medium">@{reply.actor}</span> {reply.body}
                        </p>
                      ))}
                      {canEdit && !item.removed && day.status !== "skipped" && (
                        <button
                          type="button"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate({ dayId: day.id, index: item.index })}
                          className="btn btn-danger-quiet mt-1"
                          aria-label={`Take out the post by ${item.actor} at ${clock(item.minute)}`}
                        >
                          Take out
                        </button>
                      )}
                    </div>
                  ))}
                  {canEdit && day.status === "held" && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ dayId: day.id, decision: "approve" })}
                        className="btn btn-primary"
                      >
                        Approve this day
                      </button>
                      <button
                        type="button"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ dayId: day.id, decision: "skip" })}
                        className="btn"
                      >
                        Skip it
                      </button>
                    </div>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
