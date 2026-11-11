import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { FeedPost, FeedResponse, Highlight } from "@truman3/core";
import { KarmaBadge, ProfileHeader, useFeature } from "@truman3/ui";
import { useRef, useState } from "react";
import { get, post as send } from "../api.ts";
import { PostCard } from "../components/PostCard.tsx";
import { PostGrid } from "../components/PostGrid.tsx";
import { StoryViewer } from "../components/Stories.tsx";

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
  closeFriend: boolean;
  highlights: Highlight[];
  followerCount?: number;
  followingCount?: number;
  badge?: string;
  /** Where a moderator has banned them. */
  bans: { by: string; reason?: string; space?: string }[];
  bannerUrl: string | null;
  karma?: number;
  posts: FeedPost[];
}

const REPORT_REASONS = [
  ["interested", "I'm not interested in this account."],
  ["spam", "They are posting spam."],
  ["bully", "They're being abusive or harmful."],
  ["hacked", "Their account may be hacked."],
] as const;

/** Stories kept on a profile, each a circle that plays them like the row of stories does. */
function Highlights({ actor }: { actor: ActorPage }) {
  const [open, setOpen] = useState<number | null>(null);
  if (actor.highlights.length === 0) {
    return null;
  }
  const author = {
    username: actor.username,
    name: actor.name,
    pictureUrl: actor.pictureUrl,
    isViewer: actor.isViewer,
  };
  const groups = actor.highlights.map(({ stories }) => ({
    author,
    stories,
    allSeen: stories.every(({ seen }) => seen),
    closeFriends: stories.some(({ closeFriends }) => closeFriends),
  }));
  const chosen = open === null ? undefined : actor.highlights[open];
  return (
    <section aria-label="Highlights" className="overflow-x-auto bg-white py-3 sm:rounded-lg">
      <ul className="flex gap-4 px-4">
        {actor.highlights.map(({ title, stories }, index) => (
          <li key={title} className="w-16 shrink-0 text-center">
            <button
              type="button"
              aria-label={`Highlight: ${title}`}
              onClick={() => setOpen(index)}
              className="flex w-full flex-col items-center gap-1 text-xs"
            >
              <span className="block rounded-full bg-stone-300 p-[2px]">
                <span className="block h-14 w-14 overflow-hidden rounded-full border-2 border-white bg-stone-200">
                  {stories[0] && (
                    <img src={stories[0].imageUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </span>
              </span>
              <span className="w-full truncate">{title}</span>
            </button>
          </li>
        ))}
      </ul>
      {open !== null && chosen && (
        // One highlight at a time: it closes at its end rather than going on to the next.
        <StoryViewer
          groups={[groups[open] as (typeof groups)[number]]}
          start={0}
          from="highlight"
          label={`Highlight: ${chosen.title}`}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

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
  const closeFriends = useFeature("closeFriends");
  const messages = useFeature("messages");
  const tagsOn = useFeature("photoTags");
  const gridOn = useFeature("profileGrid");
  const pagesOn = useFeature("postPages");
  const grid = gridOn && pagesOn;
  const [reason, setReason] = useState<string | null>(null);
  const [openList, setOpenList] = useState<"saved" | "hidden" | null>(null);
  const commentsOn = useFeature("comments");
  const [tab, setTab] = useState<"posts" | "replies" | "media" | "tagged">("posts");
  // A grid of photos is already their media, so only a list gets a tab of it. Replies are where
  // they live on a post's own page, as on Bluesky and Reddit, rather than open under each post.
  const repliesTab = commentsOn && pagesOn && !grid;
  const tabs = [
    ["posts", "Posts"] as const,
    ...(repliesTab ? [["replies", "Replies"] as const] : []),
    ...(grid ? [] : [["media", "Media"] as const]),
    ...(tagsOn ? [["tagged", "Tagged"] as const] : []),
  ];
  const tagged = useQuery({
    queryKey: ["feed", "tagged", username],
    queryFn: () =>
      get<FeedResponse>(`/feed?surface=tagged&username=${encodeURIComponent(username)}`),
    enabled: tagsOn && tab === "tagged",
  });
  const replies = useQuery({
    queryKey: ["feed", "replies", username],
    queryFn: () =>
      get<FeedResponse>(`/feed?surface=replies&username=${encodeURIComponent(username)}`),
    enabled: repliesTab && tab === "replies",
  });

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
      <ProfileHeader
        username={actor.username}
        name={actor.name}
        pictureUrl={actor.pictureUrl}
        bannerUrl={actor.bannerUrl}
        bio={actor.bio}
        location={actor.location}
        counts={
          actor.followerCount === undefined
            ? {}
            : {
                posts: actor.posts.filter((post) => !post.repostedBy).length,
                followers: actor.followerCount,
                following: actor.followingCount ?? 0,
              }
        }
        extras={
          <>
            <KarmaBadge author={actor} />
            {actor.badge && (
              <p
                data-testid="author-badge"
                className="rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-900"
              >
                {actor.badge}
              </p>
            )}
            {actor.bans.map(({ by, reason, space }) => (
              <p
                key={space ?? "everywhere"}
                data-testid="banned-note"
                className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600"
              >
                Banned{space ? ` from ${space}` : ""} by {by}.{reason ? ` Reason: ${reason}` : ""}
              </p>
            ))}
          </>
        }
        actions={
          actor.isViewer ? (
            <Link to="/account" className={button}>
              Edit profile
            </Link>
          ) : (
            <>
              {following && (
                <button
                  type="button"
                  className={button}
                  onClick={() => relate.mutate({ action: actor.following ? "unfollow" : "follow" })}
                >
                  {actor.following ? "Following" : "Follow"}
                </button>
              )}
              {messages && (
                <Link
                  to="/messages/$username"
                  params={{ username: actor.username }}
                  className={button}
                >
                  Message
                </Link>
              )}
              {closeFriends && (
                <button
                  type="button"
                  aria-pressed={actor.closeFriend}
                  className={`${button} ${actor.closeFriend ? "border-green-600 text-green-700" : ""}`}
                  onClick={() =>
                    relate.mutate({
                      action: actor.closeFriend ? "removeCloseFriend" : "addCloseFriend",
                    })
                  }
                >
                  {actor.closeFriend ? "Close friend ✓" : "Add to close friends"}
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
            </>
          )
        }
      />

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

      <Highlights actor={actor} />

      {actor.isViewer && <OwnLists open={openList} setOpen={setOpenList} />}

      {!openList && tabs.length > 1 && (
        <div role="tablist" aria-label="Profile" className="flex justify-center gap-8 text-sm">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`border-t-2 px-2 py-2 font-medium ${tab === key ? "border-stone-900" : "border-transparent text-stone-500"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* An open list takes the place of their posts, so what's on screen is one list at a time. */}
      {!openList && (
        <ProfilePosts
          posts={
            tab === "tagged"
              ? (tagged.data?.posts ?? [])
              : tab === "replies"
                ? (replies.data?.posts ?? [])
                : tab === "media"
                  ? actor.posts.filter((post) => post.attachments.length > 0)
                  : actor.posts
          }
          loading={(tab === "tagged" && !tagged.data) || (tab === "replies" && !replies.data)}
          grid={grid}
          label={tabs.find(([key]) => key === tab)?.[1] ?? "Posts"}
          surface={tab === "tagged" || tab === "replies" ? tab : "profile"}
        />
      )}
    </div>
  );
}

/** Someone's posts, or posts they're tagged in, as a grid or a list. */
function ProfilePosts({
  posts,
  loading,
  grid,
  label,
  surface,
}: {
  posts: FeedPost[];
  loading: boolean;
  grid: boolean;
  label: string;
  surface: string;
}) {
  if (loading) {
    return null;
  }
  if (posts.length === 0) {
    return <p className="p-6 text-center text-stone-500">No posts to show.</p>;
  }
  if (grid) {
    return <PostGrid posts={posts} label={label} />;
  }
  return (
    <>
      {posts.map((post) => (
        <PostCard key={post.repostedBy?.id ?? post.id} post={post} surface={surface} />
      ))}
    </>
  );
}
