import type { ReactNode } from "react";

/** Simple outline icons, drawn here so no platform's own icons are used. */
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
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
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

/** The icon a page link goes with, by its key. */
export function LinkIcon({ name, className }: { name: string; className?: string }) {
  const props = className ? { className } : {};
  switch (name) {
    case "home":
      return <HomeIcon {...props} />;
    case "explore":
      return <SearchIcon {...props} />;
    case "notifications":
      return <HeartIcon {...props} />;
    case "profile":
      return <UserIcon {...props} />;
    default:
      return <GridIcon {...props} />;
  }
}
