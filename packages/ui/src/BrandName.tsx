import type { LayoutKey } from "@truman3/core";
import { useId } from "react";
import { usePlatform } from "./platform.tsx";

/**
 * A mark for each kind of site, for a study with no logo of its own. They're drawn here and belong
 * to no real platform. Each takes the site's main color, so a study that changes it gets a mark to
 * match.
 */
export function BrandMark({
  layout,
  className = "h-9 w-9",
}: {
  layout: LayoutKey;
  className?: string;
}) {
  const id = useId();
  const box = `${className} shrink-0`;
  switch (layout) {
    case "classic":
      // Two rings that overlap: people with something in common.
      return (
        <svg aria-hidden="true" viewBox="0 0 40 40" className={box}>
          <circle cx="20" cy="20" r="20" fill="var(--color-accent-fill)" />
          <g fill="none" stroke="var(--color-on-accent)" strokeWidth="3.4">
            <circle cx="15.5" cy="20" r="7" />
            <circle cx="24.5" cy="20" r="7" />
          </g>
        </svg>
      );
    case "photo":
      // A flash going off, in a sunset.
      return (
        <svg aria-hidden="true" viewBox="0 0 40 40" className={box}>
          <defs>
            <linearGradient id={id} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#f59e0b" />
              <stop offset="0.5" stopColor="#f43f5e" />
              <stop offset="1" stopColor="#c026d3" />
            </linearGradient>
          </defs>
          <rect width="40" height="40" rx="11" fill={`url(#${id})`} />
          <path
            d="M20 7c1.2 6.8 6.2 11.8 13 13-6.8 1.2-11.8 6.2-13 13-1.2-6.8-6.2-11.8-13-13 6.8-1.2 11.8-6.2 13-13z"
            fill="#fff"
          />
        </svg>
      );
    case "short-posts":
      // A row of rooftops.
      return (
        <svg aria-hidden="true" viewBox="0 0 40 40" className={box}>
          <rect width="40" height="40" rx="9" fill="var(--color-accent-fill)" />
          <path d="M7 31V20h6v-8h7v6h5v-9h8v22z" fill="var(--color-on-accent)" />
        </svg>
      );
    default:
      // A speech bubble with a thread running through it.
      return (
        <svg aria-hidden="true" viewBox="0 0 40 40" className={box}>
          <circle cx="20" cy="20" r="20" fill="var(--color-accent-fill)" />
          <path
            d="M10 12.5h20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H19l-6 5v-5h-3a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2z"
            fill="var(--color-on-accent)"
          />
          <path
            d="M13 17h14M13 21.5h9"
            stroke="var(--color-accent-fill)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

/**
 * The site's name in the header, for a study with no logo of its own. Each kind of site writes it its
 * own way, so two studies don't look like one site with the name changed.
 */
export function BrandName({ name }: { name: string }) {
  const { layout } = usePlatform();
  switch (layout) {
    case "classic":
      return (
        <>
          <BrandMark layout={layout} />
          <span className="truncate text-xl font-bold tracking-tight text-accent">{name}</span>
        </>
      );
    case "forum":
      return (
        <>
          <BrandMark layout={layout} className="h-8 w-8" />
          <span className="truncate text-xl font-extrabold tracking-tight lowercase">{name}</span>
        </>
      );
    case "photo":
      return (
        <>
          <BrandMark layout={layout} className="h-8 w-8" />
          <span className="truncate font-serif text-2xl font-bold tracking-tight italic xl:inline">
            {name}
          </span>
        </>
      );
    default:
      return (
        <>
          <BrandMark layout={layout} className="h-8 w-8" />
          <span className="truncate text-xl font-black tracking-tight">{name}</span>
        </>
      );
  }
}
