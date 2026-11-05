import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { FeedPost, FeedResponse } from "@truman3/core";
import { Avatar, KarmaBadge, useFeature } from "@truman3/ui";
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
  muted: boolean;
  followerCount?: number;
  followingCount?: number;
  badge?: string;
  /** Where a moderator has banned them. */
  bans: { by: string; reason?: string; space?: string }[];
  karma?: number;
  posts: FeedPost[];
}

const REPORT_REASONS = [
  ["interested", "I'm not interested in this account."],
  ["spam", "They are posting spam."],
  ["bully", "They're being abusive or harmful."],
  ["hacked", "Their account may be hacked."],
] as const;

/** What this person saved or hid, which only they can see, on their own profile. */
function OwnLists({
  open,
  setOpen,
}: {
  open: "saved" | "hidden" | null;
  setOpen: (list: "saved" | "hidden" | null) => void;
}) {
  const saving = useFeature("saving");
  const hiding = useFeature("hiding");
  const list = useQuery({
    queryKey: ["feed", open],
    queryFn: () => get<FeedResponse>(`/feed?surface=${open}`),
    enabled: open !== null,
  });
  if (!saving && !hiding) {
    return null;
  }
  const tab = (key: "saved" | "hidden", label: string) => (
    <button
      type="button"
      aria-pressed={open === key}
      onClick={() => setOpen(open === key ? null : key)}
      className={`rounded-full px-3 py-1 text-sm font-medium ${open === key ? "bg-stone-900 text-white" : "bg-stone-200 text-stone-700"}`}
    >
      {label}
    </button>
  );
  return (
    <section aria-label="Your saved and hidden posts" className="space-y-3 sm:space-y-4">
      <div className="flex justify-center gap-2 px-3 sm:px-0">
        {saving && tab("saved", "Saved")}
        {hiding && tab("hidden", "Hidden")}
      </div>
      {open && list.data?.posts.length === 0 && (
        <p className="p-6 text-center text-stone-500">Nothing here yet.</p>
      )}
      {open &&
        list.data?.posts.map((post) => (
          <PostCard key={post.repostedBy?.id ?? post.id} post={post} surface={open} />
        ))}
    </section>
  );
}

export function ProfilePage() {
  const { username } = useParams({ from: "/gate/u/$username" });
  const client = useQueryClient();
  const reportDialog = useRef<HTMLDialogElement>(null);
  const following = useFeature("following");
  const blocking = useFeature("blocking");
  const reporting = useFeature("reporting");
  const muting = useFeature("muting");
  const [reason, setReason] = useState<string | null>(null);
  const [openList, setOpenList] = useState<"saved" | "hidden" | null>(null);

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
    <div className="mx-auto max-w-xl space-y-3 sm:space-y-4">
      <section className="flex flex-col items-center gap-2 bg-white p-6 text-center shadow-sm sm:rounded-lg">
        <Avatar seed={actor.username} url={actor.pictureUrl} size="h-24 w-24" />
        <h1 className="text-xl font-semibold">{actor.name}</h1>
        <p className="text-sm text-stone-500">@{actor.username}</p>
        <KarmaBadge author={actor} />
        {actor.badge && (
          <p
            data-testid="author-badge"
            className="rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-900"
          >
            {actor.badge}
          </p>
        )}
        {actor.followerCount !== undefined && (
          <p data-testid="follow-counts" className="text-sm text-stone-600">
            <strong>{actor.followingCount ?? 0}</strong> following ·{" "}
            <strong>{actor.followerCount}</strong>{" "}
            {actor.followerCount === 1 ? "follower" : "followers"}
          </p>
        )}
        {actor.bio && <p className="whitespace-pre-wrap">{actor.bio}</p>}
        {actor.location && <p className="text-sm text-stone-500">{actor.location}</p>}
        {actor.bans.map(({ by, reason, space }) => (
          <p
            key={space ?? "everywhere"}
            data-testid="banned-note"
            className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600"
          >
            Banned{space ? ` from ${space}` : ""} by {by}.{reason ? ` Reason: ${reason}` : ""}
          </p>
        ))}
        {actor.isViewer && (
          <Link to="/account" className={`mt-2 ${button}`}>
            Edit profile
          </Link>
        )}
        {!actor.isViewer && (
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {following && (
              <button
                type="button"
                className={button}
                onClick={() => relate.mutate({ action: actor.following ? "unfollow" : "follow" })}
              >
                {actor.following ? "Following" : "Follow"}
              </button>
            )}
            {muting && (
              <button
                type="button"
                className={button}
                onClick={() => relate.mutate({ action: actor.muted ? "unmute" : "mute" })}
              >
                {actor.muted ? "Unmute" : "Mute"}
              </button>
            )}
            {blocking && (
              <button
                type="button"
                className={button}
                onClick={() => relate.mutate({ action: actor.blocked ? "unblock" : "block" })}
              >
                {actor.blocked ? "Unblock" : "Block"}
              </button>
            )}
            {reporting && (
              <button
                type="button"
                className={button}
                disabled={actor.reported}
                onClick={() => reportDialog.current?.showModal()}
              >
                {actor.reported ? "Reported" : "Report"}
              </button>
            )}
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

      {actor.isViewer && <OwnLists open={openList} setOpen={setOpenList} />}

      {/* An open list takes the place of their posts, so what's on screen is one list at a time. */}
      {!openList && actor.posts.length === 0 && (
        <p className="p-6 text-center text-stone-500">No posts to show.</p>
      )}
      {!openList &&
        actor.posts.map((post) => (
          <PostCard key={post.repostedBy?.id ?? post.id} post={post} surface="profile" />
        ))}
    </div>
  );
}
