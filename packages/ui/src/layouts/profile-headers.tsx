import type { ReactNode } from "react";
import { Avatar } from "../Avatar.tsx";
import type { ProfileHeaderProps } from "./page-props.ts";

function Count({ value, one, many }: { value: number | undefined; one: string; many: string }) {
  if (value === undefined) {
    return null;
  }
  return (
    <span>
      <strong className="font-semibold">{value.toLocaleString("en-US")}</strong>{" "}
      {value === 1 ? one : many}
    </span>
  );
}

function Counts({
  counts,
  className,
}: {
  counts: ProfileHeaderProps["counts"];
  className: string;
}) {
  const { posts, followers, following } = counts;
  if (posts === undefined && followers === undefined && following === undefined) {
    return null;
  }
  return (
    <p data-testid="follow-counts" className={className}>
      <Count value={posts} one="post" many="posts" />
      <Count value={followers} one="follower" many="followers" />
      <Count value={following} one="following" many="following" />
    </p>
  );
}

function About({ bio, location }: { bio: string; location: string }): ReactNode {
  return (
    <>
      {bio && <p className="whitespace-pre-wrap">{bio}</p>}
      {location && <p className="text-sm text-stone-500">{location}</p>}
    </>
  );
}

/** The centered card has never counted posts, so it keeps not counting them. */
function withoutPosts({ posts: _posts, ...rest }: ProfileHeaderProps["counts"]) {
  return rest;
}

/** Centered on a card: the picture, the name, and what they've said about themselves. */
export function CenteredProfileHeader(props: ProfileHeaderProps) {
  const { username, name, pictureUrl, counts, extras, actions } = props;
  return (
    <section className="flex flex-col items-center gap-2 bg-white p-6 text-center shadow-sm sm:rounded-lg">
      <Avatar seed={username} url={pictureUrl} size="h-24 w-24" />
      <h1 className="text-xl font-semibold">{name}</h1>
      <p className="text-sm text-stone-500">@{username}</p>
      {extras}
      <Counts counts={withoutPosts(counts)} className="flex gap-2 text-sm text-stone-600" />
      <About {...props} />
      <div className="mt-2 flex flex-wrap justify-center gap-2">{actions}</div>
    </section>
  );
}

/**
 * A wide cover with the picture over its lower edge and the name beside it, as a community feed's
 * profiles have. Without a banner of their own, the cover is a wash of the site's color.
 */
export function CoverProfileHeader(props: ProfileHeaderProps) {
  const { username, name, pictureUrl, bannerUrl, counts, extras, actions } = props;
  return (
    <section className="overflow-hidden bg-white shadow-sm sm:rounded-lg">
      <div
        data-testid="profile-banner"
        className="h-36 bg-gradient-to-br from-accent/25 via-accent/45 to-accent/70 bg-cover bg-center sm:h-52"
        style={bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : undefined}
      />
      <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:items-end sm:px-6">
        <span className="-mt-12 w-fit shrink-0 rounded-full border-4 border-white bg-white sm:-mt-10">
          <Avatar seed={username} url={pictureUrl} size="h-28 w-28 sm:h-36 sm:w-36" />
        </span>
        <div className="min-w-0 flex-1 sm:pb-2">
          <h1 className="text-2xl font-bold sm:text-3xl">{name}</h1>
          <p className="text-sm text-stone-500">@{username}</p>
          <Counts
            counts={withoutPosts(counts)}
            className="mt-0.5 flex flex-wrap gap-x-3 text-sm font-medium whitespace-nowrap text-stone-600"
          />
          {/* Under the name, where there's room for all of them without squeezing it. */}
          <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
        </div>
      </div>
      <div className="space-y-1 border-t border-stone-200 px-4 py-3 text-sm sm:px-6">
        <div className="flex flex-wrap gap-2 empty:hidden">{extras}</div>
        <About {...props} />
      </div>
    </section>
  );
}

/** A banner across the top, the picture overlapping it, then the name, counts, and bio. */
export function BannerProfileHeader(props: ProfileHeaderProps) {
  const { username, name, pictureUrl, bannerUrl, counts, extras, actions } = props;
  return (
    <section className="overflow-hidden border-b border-stone-200 bg-white sm:rounded-lg sm:border">
      <div
        data-testid="profile-banner"
        className="h-32 bg-gradient-to-r from-accent/40 to-accent/80 bg-cover bg-center sm:h-40"
        style={bannerUrl ? { backgroundImage: `url("${bannerUrl}")` } : undefined}
      />
      <div className="px-4 pb-4">
        <div className="-mt-10 flex items-end justify-between gap-2">
          <span className="rounded-full border-4 border-white bg-white">
            <Avatar seed={username} url={pictureUrl} size="h-20 w-20" />
          </span>
          <div className="flex flex-wrap justify-end gap-2">{actions}</div>
        </div>
        <h1 className="mt-2 text-2xl font-bold">{name}</h1>
        <p className="text-sm text-stone-500">@{username}</p>
        <div className="mt-1 flex flex-wrap gap-2">{extras}</div>
        <Counts counts={counts} className="mt-2 flex flex-wrap gap-3 text-sm text-stone-600" />
        <div className="mt-2 space-y-1 text-sm">
          <About {...props} />
        </div>
      </div>
    </section>
  );
}

/** The picture on the left, and beside it the name, buttons, and counts in a row, then the bio. */
export function PhotoProfileHeader(props: ProfileHeaderProps) {
  const { username, name, pictureUrl, counts, extras, actions } = props;
  return (
    <section className="bg-white p-4 sm:rounded-lg sm:p-6">
      <div className="flex items-center gap-5 sm:gap-10">
        <Avatar seed={username} url={pictureUrl} size="h-20 w-20 sm:h-36 sm:w-36" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl">{username}</h1>
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
          <Counts counts={counts} className="flex flex-wrap gap-4 text-sm sm:gap-8" />
        </div>
      </div>
      <div className="mt-3 space-y-1 text-sm">
        <p className="font-semibold">{name}</p>
        <div className="flex flex-wrap gap-2">{extras}</div>
        <About {...props} />
      </div>
    </section>
  );
}
