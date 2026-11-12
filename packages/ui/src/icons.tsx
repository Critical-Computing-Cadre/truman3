import type { ReactNode } from "react";
import { usePlatform } from "./platform.tsx";

/**
 * Simple outline icons, drawn here so no platform's own icons are used. How heavy the lines are
 * belongs to the kind of site (skins.css), so a photo app's are finer than a forum's.
 */
function Icon({
  children,
  filled = false,
  className = "h-6 w-6",
}: {
  children: ReactNode;
  filled?: boolean;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ strokeWidth: "var(--icon-stroke, 1.8)" }}
    >
      {children}
    </svg>
  );
}

type IconProps = { filled?: boolean; className?: string };

export const HomeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />
  </Icon>
);
export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);
export const HeartIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z" />
  </Icon>
);
export const CommentIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-4.8A8.5 8.5 0 1 1 21 11.5z" />
  </Icon>
);
export const RepostIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />
  </Icon>
);
export const ShareIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
  </Icon>
);
export const BookmarkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 3h12v18l-6-4-6 4z" />
  </Icon>
);
export const MessageIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </Icon>
);
export const UserIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);
export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <path d="M12 8v8M8 12h8" />
  </Icon>
);
export const GridIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </Icon>
);
export const DotsIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </Icon>
);
export const ThumbIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 10v11H3V10zM7 10l4-8a2.5 2.5 0 0 1 2.5 2.5V9h5.2a2 2 0 0 1 2 2.4l-1.4 7.5a2.6 2.6 0 0 1-2.5 2.1H7" />
  </Icon>
);
export const BellIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7 2.5 8h-17C3.5 16 6 15 6 9zM10 20.5a2.2 2.2 0 0 0 4 0" />
  </Icon>
);
export const UpIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3 4 12h4.5v8h7v-8H20z" />
  </Icon>
);
export const DownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 21 4 12h4.5V4h7v8H20z" />
  </Icon>
);
export const PeopleIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.400M18.5 14.2A6.5 6.5 0 0 1 21.5 20" />
  </Icon>
);
export const PageIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" />
  </Icon>
);
export const ShieldIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3 4.5 6v5.5c0 4.5 3 8 7.5 9.5 4.5-1.5 7.5-5 7.5-9.5V6z" />
  </Icon>
);
export const PenIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5zM14 6.5l3 3" />
  </Icon>
);

/** The icon a page link goes with, by its key. */
export function LinkIcon({
  name,
  className,
  filled,
}: {
  name: string;
  className?: string;
  filled?: boolean;
}) {
  const { layout } = usePlatform();
  const props = { ...(className ? { className } : {}), ...(filled ? { filled } : {}) };
  switch (name) {
    case "home":
      return <HomeIcon {...props} />;
    case "explore":
      return <SearchIcon {...props} />;
    case "notifications":
      // A heart on a photo app, where most of what's new is likes. A bell everywhere else.
      return layout === "photo" ? <HeartIcon {...props} /> : <BellIcon {...props} />;
    case "spaces":
      return <PeopleIcon {...props} />;
    case "rules":
      return <PageIcon {...props} />;
    case "mod-log":
      return <ShieldIcon {...props} />;
    case "messages":
      return <MessageIcon {...props} />;
    case "profile":
      return <UserIcon {...props} />;
    default:
      return <GridIcon {...props} />;
  }
}
