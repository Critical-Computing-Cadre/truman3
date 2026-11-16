import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { get, post, send } from "../api.ts";

interface Reminders {
  on: boolean;
  afterHours: number;
  message: string;
  by: string | null;
  due: number | null;
  problem: string | null;
  sent: { day: string; people: number }[];
}

const people = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;

/**
 * Reminders to come back, for a study that lasts days (ADR 90). Turned on once, they go out by
 * themselves, through Prolific's own messages, as whoever turned them on. They can also be sent
 * there and then.
 */
export function RemindersCard({ studyId }: { studyId: string }) {
  const client = useQueryClient();
  const key = ["prolific-reminders", studyId];
  const state = useQuery({
    queryKey: key,
    queryFn: () => get<Reminders>(`/admin/studies/${studyId}/prolific/reminders`),
  });
  const [on, setOn] = useState(false);
  const [afterHours, setAfterHours] = useState("20");
  const [message, setMessage] = useState("");
  // What's typed follows what's saved, whenever that changes.
  const saved = state.data;
  useEffect(() => {
    if (saved) {
      setOn(saved.on);
      setAfterHours(String(saved.afterHours));
      setMessage(saved.message);
    }
  }, [saved]);

  const refresh = () => {
    client.invalidateQueries({ queryKey: key });
    client.invalidateQueries({ queryKey: ["prolific", studyId] });
  };
  const save = useMutation({
    mutationFn: () =>
      send("PUT", `/admin/studies/${studyId}/prolific/reminders`, {
        on,
        afterHours: Number(afterHours),
        message,
      }),
    onSuccess: refresh,
  });
  const sendNow = useMutation({
    mutationFn: () =>
      post<{ sent: number; failed: number }>(`/admin/studies/${studyId}/prolific/reminders/send`),
    onSuccess: refresh,
  });

  if (!saved) {
    return null;
  }
  const hours = Number(afterHours);
  const hoursOk = Number.isInteger(hours) && hours >= 1 && hours <= 336;
  const hasLink = message.includes("{link}");
  const changed =
    on !== saved.on || afterHours !== String(saved.afterHours) || message !== saved.message;

  return (
    <section aria-label="Reminders to come back" className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">Reminders to come back</h2>
        <span className={`badge ${saved.on ? "badge-good" : ""}`}>
          {saved.on ? `On, sent as ${saved.by ?? "someone who's left"}` : "Off"}
        </span>
      </div>
      <p className="text-sm text-stone-600">
        For a study that lasts more than a day. Someone who's part way through and hasn't visited
        for a while gets a message in their Prolific inbox, with their own link back in. Nobody gets
        more than one a day, and they stop when the study's days are up for that person.
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label className="flex items-baseline gap-2 text-sm">
          <input type="checkbox" checked={on} onChange={(event) => setOn(event.target.checked)} />
          <span>
            <span className="font-medium">Send them automatically</span>{" "}
            <span className="text-stone-500">
              Checked every 15 minutes, and sent with your Prolific connection.
            </span>
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Hours since their last visit
          <input
            type="number"
            min={1}
            max={336}
            value={afterHours}
            onChange={(event) => setAfterHours(event.target.value)}
            className="w-28 rounded border border-stone-300 px-2 py-1.5 font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          What it says
          <textarea
            rows={3}
            maxLength={1000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="rounded border border-stone-300 p-2 font-normal"
          />
          <span className="text-xs font-normal text-stone-500">
            <code>{"{link}"}</code> becomes each person's own way back in. <code>{"{site}"}</code>{" "}
            becomes the site's name. Don't name the study's real purpose here if your study doesn't
            elsewhere.
          </span>
        </label>
        {!hasLink && (
          <p role="alert" className="text-sm text-rose-700">
            The message needs {"{link}"} in it, or nobody can get back from it.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={!changed || !hasLink || !hoursOk || save.isPending}
            className="btn btn-primary"
          >
            Save reminders
          </button>
          <button
            type="button"
            disabled={!saved.due || changed || sendNow.isPending}
            onClick={() => sendNow.mutate()}
            className="btn"
          >
            {saved.due ? `Send to ${people(saved.due)} now` : "Send now"}
          </button>
          <span className="text-sm text-stone-600">
            {saved.problem ??
              (saved.due === 0
                ? "Nobody is due one right now."
                : `${people(saved.due ?? 0)} due one now.`)}
          </span>
        </div>
        {changed && (saved.due ?? 0) > 0 && (
          <p className="text-xs text-stone-500">Save your changes before sending.</p>
        )}
      </form>
      {sendNow.data && (
        <p role="status" className="text-sm text-emerald-800">
          Sent to {people(sendNow.data.sent)}.
          {sendNow.data.failed > 0 &&
            ` Prolific refused ${people(sendNow.data.failed)}, who can be tried again.`}
        </p>
      )}
      {(save.error || sendNow.error) && (
        <p role="alert" className="text-sm text-rose-700">
          {(save.error ?? sendNow.error)?.message}
        </p>
      )}
      {saved.sent.length > 0 && (
        <p className="text-xs text-stone-500">
          Sent lately: {saved.sent.map(({ day, people: count }) => `${day}: ${count}`).join(" · ")}
        </p>
      )}
    </section>
  );
}
