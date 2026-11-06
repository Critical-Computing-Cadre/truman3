import type { LayoutKey } from "@truman3/core";
import type { ComponentType } from "react";
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
  SpaceFrameProps,
} from "./layouts/page-props.ts";
import {
  PhotoFeedFrame,
  PhotoHeader,
  PhotoPostFrame,
  PhotoSpaceFrame,
} from "./layouts/photo-page.tsx";
import { usePlatform } from "./platform.tsx";

/** The page around posts belongs to a layout too, so these pick the one for this platform. */
const FRAMES: Record<
  LayoutKey,
  {
    Header: ComponentType<PageHeaderProps>;
    Feed: ComponentType<FeedFrameProps>;
    Space: ComponentType<SpaceFrameProps>;
    Post: ComponentType<PostFrameProps>;
  }
> = {
  classic: {
    Header: ClassicHeader,
    Feed: ClassicFeedFrame,
    Space: ClassicSpaceFrame,
    Post: ClassicPostFrame,
  },
  forum: {
    Header: ForumHeader,
    Feed: ForumFeedFrame,
    Space: ForumSpaceFrame,
    Post: ForumPostFrame,
  },
  // Its own posts, in the same frame as Forum for now. Templates get their own look later.
  "short-posts": {
    Header: ForumHeader,
    Feed: ForumFeedFrame,
    Space: ForumSpaceFrame,
    Post: ForumPostFrame,
  },
  photo: {
    Header: PhotoHeader,
    Feed: PhotoFeedFrame,
    Space: PhotoSpaceFrame,
    Post: PhotoPostFrame,
  },
};

export function PageHeader(props: PageHeaderProps) {
  const { Header } = FRAMES[usePlatform().layout];
  return <Header {...props} />;
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
