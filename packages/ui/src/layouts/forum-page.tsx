import { useState } from "react";
import type {
  FeedFrameProps,
  PageHeaderProps,
  PostFrameProps,
  SpaceFrameProps,
} from "./page-props.ts";

const SIDE_GRID =
  "justify-center gap-5 lg:grid lg:grid-cols-[minmax(0,44rem)_20rem] lg:items-start";

/** A top bar with the name, and on a phone, tabs along the bottom, where a thumb reaches. */
export function ForumHeader({ renderBrand, home, links, action }: PageHeaderProps) {
  const tabs = [home, ...links];
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white">
        <nav className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4">
          {renderBrand("mr-auto flex min-w-0 items-center gap-2 text-lg font-bold")}
          {links.map(({ key, render }) => (
            <span key={key} className="hidden md:contents">
              {render("rounded-full px-3 py-2 text-sm font-medium hover:bg-stone-100")}
            </span>
          ))}
          {action && <span className="ml-2 shrink-0">{action}</span>}
        </nav>
      </header>
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-stone-200 bg-white md:hidden"
      >
        {tabs.map(({ key, render }) => (
          <span key={key} className="contents">
            {render("min-w-0 flex-1 truncate px-1 py-3 text-center text-xs font-medium")}
          </span>
        ))}
      </nav>
    </>
  );
}

export function ForumFeedFrame({ renderProfile, side, children }: FeedFrameProps) {
  return (
    <div className={SIDE_GRID}>
      <div className="min-w-0 space-y-3">{children}</div>
      <aside aria-label="About you" className="sticky top-18 hidden space-y-4 lg:block">
        {renderProfile(true)}
        {side}
      </aside>
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
