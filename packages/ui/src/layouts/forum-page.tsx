import { useState } from "react";
import { Decor, MessagesDock, SearchBox, SmallPrint, useChrome, useDecor } from "../chrome.tsx";
import { LinkIcon } from "../icons.tsx";
import type {
  FeedFrameProps,
  PageHeaderProps,
  PostFrameProps,
  SpaceFrameProps,
} from "./page-props.ts";

const SIDE_GRID =
  "justify-center gap-5 lg:grid lg:grid-cols-[minmax(0,44rem)_20rem] lg:items-start";

function Glyph({ d }: { d: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
    >
      <path d={d} />
    </svg>
  );
}

/** Places a discussion site has that a study doesn't, for show. */
const FEEDS = [
  ["Popular", "M4 20 10 12l4 4 6-10M15 6h5v5"],
  ["Answers", "M4 5h16v11H9l-5 4zM9.5 9a2.5 2.5 0 1 1 3.5 2.300c-.7.4-1 .8-1 1.7"],
  ["All", "M4 20V10M10 20V4M16 20v-7M22 20H2"],
] as const;
const RESOURCES = [
  ["About", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.500h.01"],
  [
    "Help",
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.500a2.5 2.5 0 1 1 3.5 2.300c-.7.4-1 .9-1 1.700M12 17h.01",
  ],
  ["Blog", "M5 4h11l3 3v13H5zM9 9h6M9 13h6M9 17h3"],
  ["Careers", "M4 8h16v11H4zM9 8V5h6v3M4 13h16"],
] as const;

/**
 * A top bar with the name, a search box in the middle, and the sections at the right. On a phone,
 * tabs along the bottom, where a thumb reaches.
 */
export function ForumHeader({ renderBrand, home, links, action }: PageHeaderProps) {
  const chrome = useChrome();
  const tabs = [home, ...links];
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white">
        <nav className="mx-auto flex h-14 max-w-[90rem] items-center gap-3 px-4">
          {renderBrand("flex min-w-0 shrink-0 items-center gap-2 text-lg font-bold lg:w-60")}
          <SearchBox
            placeholder={`Search ${chrome?.siteName ?? ""}`}
            className="mx-auto hidden w-full max-w-xl md:block"
            inputClassName="rounded-full bg-stone-100 py-2.5 focus:bg-white focus:ring-2 focus:ring-accent"
          />
          <span className="ml-auto flex items-center gap-1 md:ml-0">
            {links.map(({ key, render }) => (
              <span key={key} className="hidden md:contents">
                {render(
                  "rounded-full px-3 py-2 text-sm font-medium whitespace-nowrap hover:bg-stone-100 aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent",
                )}
              </span>
            ))}
            {action && <span className="ml-2 shrink-0">{action}</span>}
          </span>
        </nav>
      </header>
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-stone-200 bg-white md:hidden"
      >
        {tabs.map(({ key, render }) => (
          <span
            key={key}
            className="relative flex min-w-0 flex-1 flex-col items-center pt-2 text-stone-600 has-[[aria-current=page]]:text-accent"
          >
            <LinkIcon name={key} className="pointer-events-none h-5 w-5" />
            {render(
              "w-full truncate px-1 pt-0.5 pb-1.5 text-center text-[0.65rem] font-medium after:absolute after:inset-0",
            )}
          </span>
        ))}
      </nav>
    </>
  );
}

export function ForumFeedFrame({ renderProfile, side, top, children }: FeedFrameProps) {
  const decor = useDecor();
  const row = "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-stone-200/60";
  const heading = "px-3 pt-4 pb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase";
  return (
    <div className="justify-center gap-5 lg:grid lg:grid-cols-[minmax(0,44rem)_20rem] lg:items-start xl:grid-cols-[14rem_minmax(0,44rem)_20rem]">
      {/* A menu down the left where the screen is wide, as these sites have. */}
      {decor && (
        <aside aria-label="Feeds" className="sticky top-18 hidden xl:block">
          <nav className="border-r border-stone-300 pr-3">
            <p className={`${row} bg-stone-200/70 font-semibold`}>
              <Glyph d="M3 10.5 12 3l9 7.500V21h-6v-6H9v6H3z" />
              Home
            </p>
            {FEEDS.map(([word, d]) => (
              <Decor key={word} className={row}>
                <Glyph d={d} />
                {word}
              </Decor>
            ))}
            <p className={heading}>Resources</p>
            {RESOURCES.map(([word, d]) => (
              <Decor key={word} className={row}>
                <Glyph d={d} />
                {word}
              </Decor>
            ))}
            <SmallPrint
              words={["Rules", "Privacy Policy", "User Agreement", "Accessibility"]}
              className="mt-4 border-t border-stone-300 px-3 pt-3"
            />
          </nav>
        </aside>
      )}
      <div className="min-w-0 space-y-3">
        {top}
        {children}
      </div>
      <aside aria-label="About you" className="sticky top-18 hidden space-y-4 lg:block">
        {renderProfile(true)}
        {side}
        {!decor && <SmallPrint words={[]} className="px-3" />}
      </aside>
      <MessagesDock
        label="Chat"
        className="flex items-center gap-2 rounded-t-lg border border-b-0 border-stone-300 bg-white px-4 py-2 text-sm shadow-lg"
      />
    </div>
  );
}

/** Open from the start on a big screen, where there's room, and folded away above a phone's posts. */
function useRoomForDetails() {
  const [roomy] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(min-width: 1024px)").matches,
  );
  return roomy;
}

export function ForumSpaceFrame({
  label,
  bannerUrl,
  accent,
  picture,
  name,
  description,
  members,
  join,
  rules,
  children,
}: SpaceFrameProps) {
  const roomy = useRoomForDetails();
  return (
    <div className="mx-auto space-y-3 sm:space-y-4 lg:max-w-[65.25rem]">
      <section
        aria-label={label}
        className="overflow-hidden border-b border-stone-200 bg-white sm:rounded-2xl sm:border"
      >
        {/* Nothing is written over these, so a banner or color can't make the name hard to read. */}
        {bannerUrl ? (
          <img src={bannerUrl} alt="" className="h-24 w-full object-cover sm:h-40" />
        ) : (
          accent && (
            <div
              data-testid="space-color"
              className="h-14 w-full sm:h-24"
              style={{ backgroundColor: accent }}
            />
          )
        )}
        <div className="flex items-center gap-3 p-4">
          {picture}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold">{name}</h1>
            {members}
          </div>
          {join}
        </div>
      </section>
      <div className={SIDE_GRID}>
        {/* First on a phone, so it isn't lost below the posts. */}
        <aside
          aria-label={`About ${label}`}
          className="mb-3 border-b border-stone-200 bg-white text-sm sm:rounded-2xl sm:border lg:sticky lg:top-18 lg:order-2 lg:mb-0"
        >
          <details open={roomy} className="group">
            <summary className="cursor-pointer list-none px-4 py-3 font-semibold marker:hidden">
              About this community
              <span aria-hidden="true" className="float-right text-stone-500 group-open:hidden">
                +
              </span>
              <span
                aria-hidden="true"
                className="float-right hidden text-stone-500 group-open:inline"
              >
                −
              </span>
            </summary>
            <div className="space-y-3 px-4 pb-4">
              {description && <p className="break-words text-stone-700">{description}</p>}
              {rules && (
                <div>
                  <h2 className="font-semibold">Rules</h2>
                  <p className="mt-1 break-words whitespace-pre-wrap text-stone-700">{rules}</p>
                </div>
              )}
              {!description && !rules && <p className="text-stone-500">Nothing written yet.</p>}
            </div>
          </details>
        </aside>
        <div className="min-w-0 space-y-3 lg:order-1">{children}</div>
      </div>
    </div>
  );
}

export function ForumPostFrame({ side, children }: PostFrameProps) {
  return (
    <div className={SIDE_GRID}>
      <div className="min-w-0 space-y-3">{children}</div>
      {side && (
        <aside aria-label="About this community" className="sticky top-18 hidden lg:block">
          {side}
        </aside>
      )}
    </div>
  );
}
