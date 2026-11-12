import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type SpaceView, textOnAccent } from "@truman3/core";
import { flowQuery, get, post } from "../api.ts";

export const spacesQuery = {
  queryKey: ["spaces"],
  queryFn: () => get<{ spaces: SpaceView[] }>("/spaces"),
};

/** A community's picture, or its first letter if it doesn't have one. */
export function SpacePicture({ space }: { space: SpaceView }) {
  return space.pictureUrl ? (
    <img src={space.pictureUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
  ) : (
    // In the community's own color where it has one, and the site's where it doesn't.
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-accent"
      {...(space.accent
        ? { style: { backgroundColor: space.accent, color: textOnAccent(space.accent) } }
        : {})}
    >
      {space.name.charAt(0).toUpperCase()}
    </div>
  );
}

/** Joining or leaving, on a study that lets people choose. Each one is recorded. */
export function JoinButton({ space }: { space: SpaceView }) {
  const client = useQueryClient();
  const flow = useQuery(flowQuery);
  const change = useMutation({
    mutationFn: () => post(`/spaces/${space.key}/membership`, { joined: !space.joined }),
    onSettled: () => client.invalidateQueries(),
  });
  if (!flow.data?.canJoinSpaces) {
    return null;
  }
  return (
    <button
      type="button"
      disabled={change.isPending}
      onClick={() => change.mutate()}
      style={
        !space.joined && space.accent
          ? { backgroundColor: space.accent, color: textOnAccent(space.accent) }
          : undefined
      }
      className={
        space.joined
          ? "shrink-0 rounded-full border border-stone-300 px-3 py-1 text-sm"
          : "shrink-0 rounded-full bg-accent-fill px-3 py-1 text-sm text-on-accent"
      }
    >
      {space.joined ? "Leave" : "Join"}
    </button>
  );
}

/** How many members a community says it has, when the study wrote a number. */
export function MemberCount({ space }: { space: SpaceView }) {
  if (space.memberCount === null) {
    return null;
  }
  const { memberCount: count } = space;
  return (
    <p className="text-xs text-stone-500" data-testid="member-count">
      {count.toLocaleString("en-US")} {count === 1 ? "member" : "members"}
    </p>
  );
}

/** Choosing what someone shows beside their name here, from the community's list. */
export function UserFlairPicker({ space }: { space: SpaceView }) {
  const client = useQueryClient();
  const change = useMutation({
    mutationFn: (flair: string | null) => post(`/spaces/${space.key}/flair`, { flair }),
    onSettled: () => client.invalidateQueries(),
  });
  if (space.userFlair.length === 0 || !space.joined) {
    return null;
  }
  return (
    <label className="flex items-center gap-2 text-sm">
      Your flair
      <select
        value={(change.isPending ? change.variables : space.myFlair) ?? ""}
        disabled={change.isPending}
        onChange={(event) => change.mutate(event.target.value || null)}
        className="min-w-0 flex-1 rounded border border-stone-300 bg-white px-2 py-1"
      >
        <option value="">None</option>
        {space.userFlair.map(({ text }) => (
          <option key={text} value={text}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const CARD = "rounded-2xl border border-stone-200 bg-white p-4 text-sm";

/** What a community is, beside one of its posts. */
export function CommunityCard({ spaceKey }: { spaceKey: string }) {
  const spaces = useQuery(spacesQuery);
  const space = spaces.data?.spaces.find(({ key }) => key === spaceKey);
  if (!space) {
    return null;
  }
  return (
    <section className={`${CARD} space-y-3`}>
      <div className="flex items-center gap-3">
        <SpacePicture space={space} />
        <div className="min-w-0 flex-1">
          <Link
            to="/spaces/$key"
            params={{ key: space.key }}
            className="block truncate font-semibold underline-offset-2 hover:underline"
          >
            {space.name}
          </Link>
          <MemberCount space={space} />
        </div>
        <JoinButton space={space} />
      </div>
      <UserFlairPicker space={space} />
      {space.description && <p className="break-words text-stone-700">{space.description}</p>}
      {space.rules && (
        <div>
          <h2 className="font-semibold">Rules</h2>
          <p className="mt-1 break-words whitespace-pre-wrap text-stone-700">{space.rules}</p>
        </div>
      )}
    </section>
  );
}

/** The communities on this platform, beside a feed. */
export function CommunitiesCard() {
  const spaces = useQuery(spacesQuery);
  const list = spaces.data?.spaces ?? [];
  if (list.length === 0) {
    return null;
  }
  return (
    <section aria-label="Communities" className={CARD}>
      <h2 className="mb-3 text-xs font-semibold tracking-wide text-stone-500 uppercase">
        Communities
      </h2>
      <ul className="space-y-3">
        {list.map((space) => (
          <li key={space.key} className="flex items-center gap-2">
            <SpacePicture space={space} />
            <div className="min-w-0 flex-1">
              <Link
                to="/spaces/$key"
                params={{ key: space.key }}
                className="block truncate font-medium underline-offset-2 hover:underline"
              >
                {space.name}
              </Link>
              <MemberCount space={space} />
            </div>
            <JoinButton space={space} />
          </li>
        ))}
      </ul>
    </section>
  );
}
