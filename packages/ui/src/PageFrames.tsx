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
  PhotoBody,
  PhotoFeedFrame,
  PhotoHeader,
  PhotoPostFrame,
  PhotoSpaceFrame,
  ShortBody,
  ShortFeedFrame,
  ShortHeader,
  ShortPostFrame,
} from "./layouts/photo-page.tsx";
import {
  BannerProfileHeader,
  CenteredProfileHeader,
  CoverProfileHeader,
  PhotoProfileHeader,
} from "./layouts/profile-headers.tsx";
import { useIsPhone, usePlatform } from "./platform.tsx";

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
    Profile: CoverProfileHeader,
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
    Header: ShortHeader,
    Feed: ShortFeedFrame,
    Space: ForumSpaceFrame,
    Post: ShortPostFrame,
    Profile: BannerProfileHeader,
    Body: ShortBody,
  },
  photo: {
    Header: PhotoHeader,
    Feed: PhotoFeedFrame,
    Space: PhotoSpaceFrame,
    Post: PhotoPostFrame,
    Profile: PhotoProfileHeader,
    Body: PhotoBody,
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
  // Tall cards need a wide screen. On a phone they'd push the posts off it, so Classic has circles.
  const phone = useIsPhone();
  return usePlatform().layout === "classic" && !phone ? "cards" : "circles";
}
