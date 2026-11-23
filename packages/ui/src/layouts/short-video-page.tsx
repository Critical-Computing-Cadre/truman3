import { type ReactNode, useEffect, useRef } from "react";
import { AddedDecor, AddedMark, Decor, SmallPrint, useDecor } from "../chrome.tsx";
import { useVideoSound } from "../features/video.tsx";
import { usePlatform } from "../platform.tsx";
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
      className="h-6 w-6"
      style={{ strokeWidth: "var(--icon-stroke, 1.8)" }}
    >
      <path d={d} />
    </svg>
  );
}

const FRIENDS =
  "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6";
const SHOP = "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2";
const MORE = "M5 12h.01M12 12h.01M19 12h.01";

/**
 * A short-video site: a rail of sections down the left on a wide screen, with the name at its top
 * and the small print at its foot. On a phone, the sections run along the bottom, and the videos
 * fill the rest (ADR 95).
 */
export function ShortVideoHeader({ renderBrand, home, links, action }: PageHeaderProps) {
  const decor = useDecor();
  const tabs = [home, ...links];
  const item =
    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-base font-semibold hover:bg-stone-100";
  return (
    <>
      <nav
        aria-label="Sections"
        className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col gap-1 overflow-y-auto border-r border-stone-200 bg-white p-3 md:flex"
      >
        {renderBrand("mb-3 flex min-w-0 items-center gap-2 px-3 py-2 text-xl font-bold")}
        {tabs.map(({ key, render }) => (
          <span key={key} className="contents">
            {render(item)}
          </span>
        ))}
        {decor && (
          <>
            <Decor id="friends" className={item}>
              <Stroke d={FRIENDS} />
              Friends
            </Decor>
            <Decor id="live" className={item}>
              <span className="rounded bg-accent-fill px-1 text-[0.6rem] font-bold text-on-accent">
                LIVE
              </span>
              LIVE
            </Decor>
            <Decor id="shop" className={item}>
              <Stroke d={SHOP} />
              Shop
            </Decor>
            <Decor id="more" className={item}>
              <Stroke d={MORE} />
              More
            </Decor>
          </>
        )}
        <AddedDecor className={item} render={(label) => <AddedMark label={label} />} />
        {action && <div className="mt-3 px-3">{action}</div>}
        <SmallPrint className="mt-auto px-3 pt-4" />
      </nav>
      <nav
        aria-label="Sections on a phone"
        className="fixed inset-x-0 bottom-0 z-20 flex h-12 border-t border-[#222] bg-[#000] text-[#fff] md:hidden"
      >
        {tabs.map(({ key, label, render }) => (
          // Icons only on a phone, as on these apps. The word is still there for a screen reader.
          <span key={key} className="flex flex-1 justify-center" title={label}>
            {render("block h-12 w-12 overflow-hidden text-[0px]")}
          </span>
        ))}
      </nav>
    </>
  );
}

/** Every page, with room for the rail down the left, and for the sections along a phone's bottom. */
export function ShortVideoBody({ children }: { children: ReactNode }) {
  return <div className="pb-12 md:pb-0 md:pl-60">{children}</div>;
}

/**
 * Stops videos from starting until a first tap, for a study that asks for one, so sound is on from
 * the first video. Otherwise there's nothing to wait for (ADR 95).
 */
function FirstTap() {
  const { videoSound } = usePlatform();
  const sound = useVideoSound();
  const asks = videoSound === "askFirst";
  const { waitForTap } = sound;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the page opens, not each time the sound changes
  useEffect(() => {
    if (asks) {
      waitForTap();
    }
  }, [asks]);
  if (!asks || sound.started) {
    return null;
  }
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#000]/60">
      <button
        type="button"
        onClick={sound.start}
        className="rounded-full bg-white px-6 py-3 text-lg font-semibold text-stone-900 shadow-xl"
      >
        Tap to start watching
      </button>
    </div>
  );
}

/** Where posts stand one at a time, each filling the column, and a swipe or a key moves on. */
const ONE_AT_A_TIME =
  "h-full snap-y snap-mandatory overflow-y-auto overscroll-contain outline-none [scrollbar-width:none] [&>article]:aspect-auto [&>article]:h-full [&>article]:max-h-none [&>article]:max-w-none";

/**
 * The videos, one at a time, in a tall column. What sits over the feed, such as the tabs and the
 * button to post, floats across its top (ADR 95).
 */
export function ShortVideoFeedFrame({ top, children }: FeedFrameProps) {
  const scroller = useRef<HTMLDivElement>(null);
  // So the arrow keys move between videos from the start, without a click first.
  useEffect(() => {
    scroller.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="relative mx-auto h-[calc(100dvh-3rem)] w-full max-w-[28rem] bg-[#000] md:h-dvh md:bg-transparent md:py-4">
      {top && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-center justify-center gap-2 p-2 text-[#fff] md:top-4 [&>*]:pointer-events-auto [&_[role=tab]]:flex-none [&_[role=tab]]:px-2 [&_[role=tablist]]:gap-2 [&_[role=tablist]]:border-0 [&_[role=tablist]]:bg-transparent">
          {top}
        </div>
      )}
      <div
        ref={scroller}
        // A feed of articles takes Page Down and the arrow keys, as ARIA's feed pattern has it.
        role="feed"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: so the keys work without clicking it first
        tabIndex={0}
        aria-label="Videos"
        className={ONE_AT_A_TIME}
        onKeyDown={(event) => {
          // A whole video at a time, as a swipe does, rather than the browser's small step.
          const step = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 }[event.key];
          const element = scroller.current;
          if (!step || !element || event.target !== element) {
            return;
          }
          event.preventDefault();
          // To the next one itself, from whichever is showing most, so a pixel's rounding can't
          // leave it where it was.
          const posts = [...element.querySelectorAll<HTMLElement>(":scope > article")];
          const showing = posts.reduce(
            (best, post, index) =>
              Math.abs(post.offsetTop - element.scrollTop) <
              Math.abs((posts[best]?.offsetTop ?? 0) - element.scrollTop)
                ? index
                : best,
            0,
          );
          posts[showing + step]?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      >
        {children}
      </div>
      <FirstTap />
    </div>
  );
}

/** One post on its own page, the same size as in the feed. */
export function ShortVideoPostFrame({ children }: PostFrameProps) {
  return (
    <div className="mx-auto w-full max-w-[28rem] space-y-3 md:py-4 [&>article]:h-[calc(100dvh-3rem)] [&>article]:md:h-[calc(100dvh-2rem)]">
      {children}
    </div>
  );
}
