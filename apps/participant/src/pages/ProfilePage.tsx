import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import type { FeedPost } from "@truman3/core";
import { Avatar } from "@truman3/ui";
import { useRef, useState } from "react";
import { get, post as send } from "../api.ts";
import { PostCard } from "../components/PostCard.tsx";

interface ActorPage {
  username: string;
  name: string;
  bio: string;
  location: string;
  pictureUrl: string | null;
  isViewer: boolean;
  following: boolean;
  blocked: boolean;
  reported: boolean;
  posts: FeedPost[];
}

const REPORT_REASONS = [
  ["interested", "I'm not interested in this account."],
  ["spam", "They are posting spam."],
  ["bully", "They're being abusive or harmful."],
  ["hacked", "Their account may be hacked."],
] as const;

export function ProfilePage() {
  const { username } = useParams({ from: "/gate/u/$username" });
  const client = useQueryClient();
  const reportDialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<string | null>(null);

  const page = useQuery({
    queryKey: ["actor", username],
    queryFn: () => get<ActorPage>(`/actors/${encodeURIComponent(username)}`),
  });

  const relate = useMutation({
    mutationFn: (body: { action: string; reason?: string }) =>
      send(`/actors/${encodeURIComponent(username)}/relation`, body),
    onSettled: () => client.invalidateQueries(),
  });

  if (!page.data) {
    return null;
  }
  const actor = page.data;
  const button = "rounded border border-stone-300 px-3 py-1.5 text-sm";

  return (
    <div className="space-y-3 sm:space-y-4">
      <section className="flex flex-col items-center gap-2 bg-white p-6 text-center shadow-sm sm:rounded-lg">
        <Avatar name={actor.name} url={actor.pictureUrl} size="h-24 w-24" />
        <h1 className="text-xl font-semibold">{actor.name}</h1>
        <p className="text-sm text-stone-500">@{actor.username}</p>
        {actor.bio && <p className="whitespace-pre-wrap">{actor.bio}</p>}
        {actor.location && <p className="text-sm text-stone-500">{actor.location}</p>}
        {!actor.isViewer && (
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              className={button}
              onClick={() => relate.mutate({ action: actor.following ? "unfollow" : "follow" })}
            >
              {actor.following ? "Following" : "Follow"}
            </button>
            <button
              type="button"
              className={button}
              onClick={() => relate.mutate({ action: actor.blocked ? "unblock" : "block" })}
            >
              {actor.blocked ? "Unblock" : "Block"}
            </button>
            <button
              type="button"
              className={button}
              disabled={actor.reported}
              onClick={() => reportDialog.current?.showModal()}
            >
              {actor.reported ? "Reported" : "Report"}
            </button>
          </div>
        )}
      </section>

      <dialog
        ref={reportDialog}
        className="m-auto w-[min(90vw,28rem)] rounded-lg p-6 backdrop:bg-black/50"
      >
        <form
          method="dialog"
          onSubmit={() => {
            if (reason) {
              relate.mutate({ action: "report", reason });
            }
          }}
          className="flex flex-col gap-3"
        >
          <h2 className="text-lg font-semibold">Report this user</h2>
          <p>Help us understand the issue. What's the problem with this account?</p>
          {REPORT_REASONS.map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="reason" value={value} onChange={() => setReason(value)} />
              {label}
            </label>
          ))}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className={button} onClick={() => reportDialog.current?.close()}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={!reason}
              className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Submit
            </button>
          </div>
        </form>
      </dialog>

      {actor.posts.length === 0 && (
        <p className="p-6 text-center text-stone-500">No posts to show.</p>
      )}
      {actor.posts.map((post) => (
        <PostCard key={post.id} post={post} surface="profile" />
      ))}
    </div>
  );
}
