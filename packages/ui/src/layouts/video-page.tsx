import { Fragment, type ReactNode } from "react";
import {
  AddedDecor,
  AddedMark,
  ComposeButton,
  Decor,
  SearchBox,
  SmallPrint,
  useDecor,
} from "../chrome.tsx";
import { LinkIcon, PlusIcon } from "../icons.tsx";
import type { FeedFrameProps, PageHeaderProps, PostFrameProps } from "./page-props.ts";

function Stroke({ d }: { d: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
      style={{ strokeWidth: "var(--icon-stroke, 1.8)" }}
    >
      <path d={d} />
    </svg>
  );
}

const MENU: [string, string, string][] = [
  ["shorts", "Shorts", "M8 4h8l-2 6h4l-8 10 2-7H8z"],
  ["subscriptions", "Subscriptions", "M4 8h16v11H4zM7 5h10M9 11.500v5l4-2.500z"],
  ["history", "History", "M12 7v5l3 2M4 12a8 8 0 1 0 2.300-5.600M4 4v4h4"],
  ["watch-later", "Watch later", "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"],
];

/**
 * A video site (ADR 96): a bar across the top with the name, a search box, and the button to
 * post, and a menu of sections down the left on a wide screen. On a phone the sections run along
 * the bottom.
 */
export function VideoHeader({ renderBrand, home, links, action }: PageHeaderProps) {
  const decor = useDecor();
  const tabs = [home, ...links];
  const row =
    "flex w-full items-center gap-5 rounded-lg px-3 py-2 text-sm hover:bg-stone-100 aria-[current=page]:bg-stone-100 aria-[current=page]:font-semibold";
  return (
    <>
      <header data-bar="top" className="sticky top-0 z-20 bg-white">
        <nav className="flex h-14 items-center gap-4 px-4">
          {renderBrand(
            "flex min-w-0 shrink-0 items-center gap-1.5 text-lg font-bold tracking-tight md:w-52",
          )}
          <SearchBox
            placeholder="Search"
            className="mx-auto hidden w-full max-w-xl sm:block"
            inputClassName="rounded-full border border-stone-300 py-2 focus:border-accent"
          />
          {action && <span className="ml-auto shrink-0 sm:ml-0">{action}</span>}
        </nav>
      </header>
      <nav
        aria-label="Sections"
        className="fixed top-14 bottom-0 left-0 z-10 hidden w-56 flex-col gap-0.5 overflow-y-auto bg-white px-3 pb-4 md:flex"
      >
        {tabs.map(({ key, label, render }) => (
          <span key={key} className="relative flex items-center" title={label}>
            <span className="pointer-events-none absolute left-3">
              <LinkIcon name={key} className="h-5 w-5" />
            </span>
            {render(`${row} pl-12`)}
          </span>
        ))}
        {decor && (
          <>
            <hr className="my-3 border-stone-200" />
            {MENU.map(([key, label, d]) => (
              <Decor key={key} id={key} className={row}>
                <Stroke d={d} />
                {label}
              </Decor>
            ))}
          </>
        )}
        <AddedDecor
          className={row}
          render={(label) => <AddedMark label={label} className="h-5 w-5" />}
        />
        <SmallPrint className="mt-auto px-3 pt-6" />
      </nav>
      <nav
        aria-label="Sections on a phone"
        data-bar="bottom"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-stone-200 bg-white md:hidden"
      >
        {tabs.map(({ key, render }, index) => (
          <Fragment key={key}>
            <span className="relative flex min-w-0 flex-1 flex-col items-center pt-2 text-stone-700 has-[[aria-current=page]]:text-stone-950">
              <LinkIcon name={key} className="pointer-events-none h-5 w-5" />
              {render(
                "w-full truncate px-1 pt-0.5 pb-1.5 text-center text-[0.65rem] after:absolute after:inset-0",
              )}
            </span>
            {/* Starting a post sits in the middle of the tabs, as on these apps. */}
            {index === Math.ceil(tabs.length / 2) - 1 && (
              <ComposeButton className="flex min-w-0 flex-1 flex-col items-center pt-2 text-stone-700">
                <PlusIcon className="h-5 w-5" />
                <span className="w-full truncate px-1 pt-0.5 pb-1.5 text-center text-[0.65rem]">
                  Create
                </span>
              </ComposeButton>
            )}
          </Fragment>
        ))}
      </nav>
    </>
  );
}

/** Every page, with room for the menu down the left, and for the sections along a phone's bottom. */
export function VideoBody({ children }: { children: ReactNode }) {
  return <div className="px-0 pb-16 sm:px-4 md:pb-6 md:pl-60">{children}</div>;
}

/** Home: videos in a grid, as many across as fit, with anything that goes over it on top. */
export function VideoFeedFrame({ top, children }: FeedFrameProps) {
  return (
    <div className="mx-auto max-w-[110rem] space-y-4 pt-2">
      {top && (
        <div className="flex flex-wrap items-center gap-3 px-3 sm:px-0 [&_[role=tab]]:flex-none [&_[role=tab]]:px-3 [&_[role=tablist]]:gap-1">
          {top}
        </div>
      )}
      <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {children}
      </div>
    </div>
  );
}

/** A watch page: the video and what's under it, with Up next down the side on a wide screen. */
export function VideoPostFrame({ side, children }: PostFrameProps) {
  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-6 pt-2 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1 space-y-3">{children}</div>
      {side && <aside className="w-full shrink-0 px-3 sm:px-0 lg:w-[26rem]">{side}</aside>}
    </div>
  );
}
