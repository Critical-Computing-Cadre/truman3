import type { ReactNode } from "react";
import { Decor, MessagesDock, SearchBox, SmallPrint, useDecor } from "../chrome.tsx";
import { LinkIcon } from "../icons.tsx";
import { ForumSpaceFrame } from "./forum-page.tsx";
import type { FeedFrameProps, PageHeaderProps, PostFrameProps } from "./page-props.ts";

export { ForumSpaceFrame as PhotoSpaceFrame };

/** One photo and what's said under it, in a column as wide as the feed's, in the middle. */
export function PhotoPostFrame({ side, children }: PostFrameProps) {
  return (
    <div className="mx-auto flex max-w-[60rem] justify-center gap-16">
      <div className="w-full max-w-[32rem] min-w-0 space-y-3">{children}</div>
      {side && <aside className="hidden w-80 shrink-0 lg:block">{side}</aside>}
    </div>
  );
}

/** One post and its replies between the same two hairlines as the feed, with search beside it. */
export function ShortPostFrame({ side, children }: PostFrameProps) {
  return (
    <div className="mx-auto flex max-w-[64rem] justify-center gap-8">
      <div className="min-h-dvh w-full max-w-[37.5rem] min-w-0 space-y-2 border-stone-200 sm:-mt-4 sm:border-x sm:pt-3">
        {children}
      </div>
      <aside className="sticky top-3 hidden w-80 shrink-0 space-y-4 self-start lg:block">
        <SearchBox
          placeholder="Search"
          inputClassName="rounded-full border border-stone-200 bg-stone-50 py-2.5 focus:border-accent"
        />
        {side}
        <SmallPrint
          words={["About", "Help", "Accessibility", "Ads info", "Blog", "Developers"]}
          className="px-2"
        />
      </aside>
    </div>
  );
}

function Stroke({ d, className = "h-6 w-6" }: { d: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ strokeWidth: "var(--icon-stroke, 1.8)" }}
    >
      <path d={d} />
    </svg>
  );
}

const REELS = "M4 4h16v16H4zM4 9h16M9 4l2.5 5M15 4l2.5 5M10.5 12.500v4l3.5-2z";
const MENU = "M4 6h16M4 12h16M4 18h16";
const APPS = "M5 4h5v5H5zM14 4h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z";

/**
 * A photo app: a narrow rail of icons down the left on a wide screen, with the sections in the
 * middle and a menu at the bottom. On a phone, a top bar with the name, and the icons along the
 * bottom.
 */
export function PhotoHeader({ renderBrand, home, links, action }: PageHeaderProps) {
  const decor = useDecor();
  const tabs = [home, ...links];
  const item = "flex h-12 w-12 items-center justify-center rounded-xl hover:bg-stone-100";
  return (
    <>
      <nav
        aria-label="Sections"
        className="fixed inset-y-0 left-0 z-20 hidden w-[4.5rem] flex-col items-center border-r border-stone-200 bg-white py-5 md:flex"
      >
        {/* Only the mark fits here. The name is in the page's title, and on a phone's top bar. */}
        {renderBrand(
          "flex h-12 w-12 items-center justify-center overflow-hidden [&>span]:sr-only [&_img]:h-8 [&_img]:max-w-10",
        )}
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          {tabs.map(({ key, label, render }) => (
            <span key={key} className="contents" title={label}>
              {render("flex h-12 w-12 overflow-hidden rounded-xl text-[0px] hover:bg-stone-100")}
            </span>
          ))}
          {decor && (
            <Decor label="Reels" className={item}>
              <Stroke d={REELS} />
            </Decor>
          )}
        </div>
        {action && <span className="mb-3 px-1 text-center">{action}</span>}
        {decor && (
          <>
            <Decor label="More" className={item}>
              <Stroke d={MENU} />
            </Decor>
            <Decor label="Also from us" className={item}>
              <Stroke d={APPS} />
            </Decor>
          </>
        )}
      </nav>
      <header className="sticky top-0 z-20 flex h-13 items-center gap-2 border-b border-stone-200 bg-white px-4 md:hidden">
        {renderBrand("mr-auto flex min-w-0 items-center gap-2 text-lg font-bold")}
        {action}
      </header>
      <nav
        aria-label="Sections on a phone"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-stone-200 bg-white md:hidden"
      >
        {tabs.map(({ key, label, render }) => (
          // Icons only on a phone, as on these platforms. The word is still there for a screen reader.
          <span key={key} className="flex flex-1 justify-center" title={label}>
            {render("block h-12 w-12 overflow-hidden text-[0px]")}
          </span>
        ))}
      </nav>
    </>
  );
}

/**
 * A microblog: a menu of icons and words down the left, with a button to post under it. On a phone,
 * a top bar with the name, and the icons along the bottom.
 */
export function ShortHeader({ renderBrand, home, links, action }: PageHeaderProps) {
  const decor = useDecor();
  const tabs = [home, ...links];
  const row =
    "flex min-h-12 items-center gap-4 rounded-full px-3 py-3 text-[0px] font-medium hover:bg-accent-soft xl:text-xl";
  return (
    <>
      <nav
        aria-label="Sections"
        className="fixed inset-y-0 left-0 z-20 hidden w-20 flex-col gap-1 border-r border-stone-200 bg-white px-3 py-4 md:flex xl:w-64"
      >
        {renderBrand(
          "mb-3 flex min-w-0 items-center gap-2 px-2 [&>span]:hidden xl:[&>span]:inline [&_img]:max-w-12 xl:[&_img]:max-w-40",
        )}
        {tabs.map(({ key, label, render }) => (
          <span key={key} className="contents">
            {/* Words only where the rail is wide enough for them, so they never spill onto posts. */}
            {render(row)}
            <span className="sr-only">{label}</span>
          </span>
        ))}
        {decor &&
          (
            [
              ["Lists", "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"],
              ["Bookmarks", "M6 3h12v18l-6-4-6 4z"],
              ["Settings", "M4 7h10M18 7h2M4 17h2M10 17h10M16 4.500v5M8 14.500v5"],
            ] as const
          ).map(([word, d]) => (
            <Decor key={word} label={word} className={`${row} w-full`}>
              <Stroke d={d} />
              <span className="hidden xl:inline">{word}</span>
            </Decor>
          ))}
        {action && <span className="mt-auto px-3">{action}</span>}
      </nav>
      <header className="sticky top-0 z-20 flex h-13 items-center gap-2 border-b border-stone-200 bg-white/90 px-4 backdrop-blur md:hidden">
        {renderBrand("mr-auto flex min-w-0 items-center gap-2 text-lg font-bold")}
        {action}
      </header>
      <nav
        aria-label="Sections on a phone"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-stone-200 bg-white md:hidden"
      >
        {tabs.map(({ key, label, render }) => (
          <span key={key} className="flex flex-1 justify-center" title={label}>
            {render("block h-12 w-12 overflow-hidden text-[0px]")}
          </span>
        ))}
      </nav>
    </>
  );
}

/** Every page, with room for the narrow rail down the left, so nothing slides under it. */
export function PhotoBody({ children }: { children: ReactNode }) {
  return <div className="md:pl-[4.5rem]">{children}</div>;
}

/** The same, for the wider menu a microblog has. */
export function ShortBody({ children }: { children: ReactNode }) {
  return <div className="md:pl-20 xl:pl-64">{children}</div>;
}

export { LinkIcon };

/** Stories across the top, then posts, with the viewer, suggestions, and small print to the right. */
export function PhotoFeedFrame({ renderProfile, side, top, children }: FeedFrameProps) {
  return (
    <div className="mx-auto flex max-w-[60rem] justify-center gap-16">
      <div className="w-full max-w-[29.5rem] min-w-0 space-y-3">
        {top}
        {children}
      </div>
      <aside
        aria-label="About you"
        className="sticky top-6 hidden w-80 shrink-0 space-y-5 self-start pt-4 lg:block"
      >
        {renderProfile(true)}
        {side}
        <SmallPrint
          words={["About", "Help", "Press", "API", "Jobs", "Locations", "Language"]}
          className="pt-2 [&>p:last-child]:tracking-wide [&>p:last-child]:uppercase"
        />
      </aside>
      <MessagesDock
        label="Messages"
        className="mb-5 flex items-center gap-3 rounded-full border border-stone-200 bg-white px-5 py-3 text-sm shadow-xl"
      />
    </div>
  );
}

/** A narrow column of posts between two hairlines, with search and what's happening to the right. */
export function ShortFeedFrame({ renderProfile, side, top, children }: FeedFrameProps) {
  return (
    <div className="mx-auto flex max-w-[64rem] justify-center gap-8">
      {/* Posts run together, with nothing but a line between them. */}
      <div className="min-h-dvh w-full max-w-[37.5rem] min-w-0 border-stone-200 sm:-mt-4 sm:border-x">
        {top}
        {children}
      </div>
      <aside
        aria-label="About you"
        className="sticky top-3 hidden w-80 shrink-0 space-y-4 self-start lg:block"
      >
        <SearchBox
          placeholder="Search"
          inputClassName="rounded-full border border-stone-200 bg-stone-50 py-2.5 focus:border-accent"
        />
        {side}
        {renderProfile(true)}
        <SmallPrint
          words={["About", "Help", "Accessibility", "Ads info", "Blog", "Developers"]}
          className="px-2"
        />
      </aside>
      <MessagesDock
        label="Chat"
        className="flex w-80 items-center gap-2 rounded-t-2xl border border-b-0 border-stone-200 bg-white px-4 py-3 text-base shadow-xl"
      />
    </div>
  );
}
