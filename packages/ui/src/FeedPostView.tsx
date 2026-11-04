import type { LayoutKey } from "@truman3/core";
import type { ComponentType } from "react";
import { ClassicPost } from "./layouts/classic.tsx";
import { ForumPost } from "./layouts/forum.tsx";
import { usePlatform } from "./platform.tsx";
import type { FeedPostViewProps } from "./post-props.ts";

const LAYOUTS: Record<LayoutKey, ComponentType<FeedPostViewProps>> = {
  classic: ClassicPost,
  forum: ForumPost,
};

/**
 * A post as participants see it, arranged by this platform's layout. Both apps draw this same
 * component, so what a researcher sees while building a study is what a participant will see.
 */
export function FeedPostView(props: FeedPostViewProps) {
  const Layout = LAYOUTS[usePlatform().layout];
  return <Layout {...props} />;
}
