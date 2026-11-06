import type { LayoutKey } from "@truman3/core";
import { type ComponentType, Fragment, type ReactNode } from "react";
import {
  ClassicFeedFrame,
  ClassicHeader,
  ClassicPostFrame,
  ClassicSpaceFrame,
} from "./layouts/classic-page.tsx";
import {
  ForumFeedFrame,
  ForumHeader,
  ForumPostFrame,
  ForumSpaceFrame,
} from "./layouts/forum-page.tsx";
import type {
  FeedFrameProps,
  PageHeaderProps,
  PostFrameProps,
  ProfileHeaderProps,
  SpaceFrameProps,
} from "./layouts/page-props.ts";
import {
  PhotoFeedFrame,
  PhotoHeader,
  PhotoPostFrame,
  PhotoSpaceFrame,
  RailBody,
  ShortFeedFrame,
} from "./layouts/photo-page.tsx";
import {
  BannerProfileHeader,
  CenteredProfileHeader,
  PhotoProfileHeader,
} from "./layouts/profile-headers.tsx";
import { usePlatform } from "./platform.tsx";

/** The page around posts belongs to a layout too, so these pick the one for this platform. */
const FRAMES: Record<
  LayoutKey,
  {
    Header: ComponentType<PageHeaderProps>;
    Feed: ComponentType<FeedFrameProps>;
    Space: ComponentType<SpaceFrameProps>;
    Post: ComponentType<PostFrameProps>;
    Profile: ComponentType<ProfileHeaderProps>;
    /** What every page sits in, such as room for a menu down the left. */
    Body: ComponentType<{ children: ReactNode }>;
  }
> = {
  classic: {
    Header: ClassicHeader,
    Feed: ClassicFeedFrame,
    Space: ClassicSpaceFrame,
    Post: ClassicPostFrame,
    Profile: CenteredProfileHeader,
    Body: Fragment,
  },
  forum: {
    Header: ForumHeader,
    Feed: ForumFeedFrame,
    Space: ForumSpaceFrame,
    Post: ForumPostFrame,
    Profile: CenteredProfileHeader,
    Body: Fragment,
  },
  // A menu of icons and words down the left, as Photo has, with a wider column of posts.
  "short-posts": {
    Header: PhotoHeader,
    Feed: ShortFeedFrame,
    Space: ForumSpaceFrame,
    Post: ForumPostFrame,
    Profile: BannerProfileHeader,
    Body: RailBody,
  },
  photo: {
    Header: PhotoHeader,
    Feed: PhotoFeedFrame,
    Space: PhotoSpaceFrame,
    Post: PhotoPostFrame,
    Profile: PhotoProfileHeader,
    Body: RailBody,
  },
};

export function PageHeader(props: PageHeaderProps) {
  const { Header } = FRAMES[usePlatform().layout];
  return <Header {...props} />;
}

/** What every page sits in, under the header. */
export function PageBody({ children }: { children: ReactNode }) {
  const { Body } = FRAMES[usePlatform().layout];
  return <Body>{children}</Body>;
}

export function FeedFrame(props: FeedFrameProps) {
  const { Feed } = FRAMES[usePlatform().layout];
  return <Feed {...props} />;
}

export function SpaceFrame(props: SpaceFrameProps) {
  const { Space } = FRAMES[usePlatform().layout];
  return <Space {...props} />;
}

export function PostFrame(props: PostFrameProps) {
  const { Post } = FRAMES[usePlatform().layout];
  return <Post {...props} />;
}

export function ProfileHeader(props: ProfileHeaderProps) {
  const { Profile } = FRAMES[usePlatform().layout];
  return <Profile {...props} />;
}

/** How a layout shows the row of stories: tall cards, as on Facebook, or circles, as on Instagram. */
export function useStoryLook(): "cards" | "circles" {
  return usePlatform().layout === "classic" ? "cards" : "circles";
}
