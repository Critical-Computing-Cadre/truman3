import type { ReactNode } from "react";

/**
 * What goes around the posts. Pages hand over the pieces, and a layout arranges them, so templates
 * can differ in more than their posts. A piece a layout has no place for is simply left out.
 */
export interface PageLink {
  key: string;
  label: string;
  render: (className: string) => ReactNode;
}

export interface PageHeaderProps {
  renderBrand: (className: string) => ReactNode;
  /** A way back to the feed, for a layout that doesn't count on the brand for that. */
  home: PageLink;
  links: PageLink[];
  /** A button that matters right now, such as finishing the study. */
  action?: ReactNode;
}

export interface FeedFrameProps {
  /** Who this is, as a large card or a compact one. */
  renderProfile: (compact: boolean) => ReactNode;
  /** Above the posts, such as a row of stories. */
  top?: ReactNode;
  /** Anything else useful beside a feed. */
  side?: ReactNode;
  children: ReactNode;
}

export interface SpaceFrameProps {
  /** Names this place, for screen readers. */
  label: string;
  bannerUrl: string | null;
  accent: string | null;
  picture: ReactNode;
  name: string;
  description: string | null;
  members: ReactNode;
  join: ReactNode;
  rules: string | null;
  /** The list of posts, and whatever goes with them. */
  children: ReactNode;
}

export interface PostFrameProps {
  /** Something useful beside one post, such as what its community is. */
  side?: ReactNode;
  children: ReactNode;
}

export interface ProfileHeaderProps {
  username: string;
  name: string;
  pictureUrl: string | null;
  /** A wide picture across the top, for a layout that has one. */
  bannerUrl: string | null;
  bio: string;
  location: string;
  /** Counts the platform shows. Any left out aren't shown. */
  counts: { posts?: number; followers?: number; following?: number };
  /** Labels and notes under the name, such as a badge, karma, or a ban. */
  extras: ReactNode;
  /** Follow, mute, and the rest, or a link to edit their own. */
  actions: ReactNode;
}
