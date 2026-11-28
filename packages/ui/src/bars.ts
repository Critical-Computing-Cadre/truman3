import { useEffect } from "react";

/** How far a finger has to move before the bars react, so a wobble doesn't flick them. */
const NUDGE = 8;
/** This close to the top of the page, the bars always show. */
const NEAR_TOP = 64;

/**
 * On a phone, the bars at the top and bottom slide away while someone scrolls down and come back
 * as soon as they scroll up, as apps do, so posts get the whole screen. This only says which way
 * the page last moved, with `data-bars="hidden"` on the page. skins.css does the sliding, for
 * anything marked `data-bar="top"` or `data-bar="bottom"`, and only at a phone's width.
 */
export function useBarsThatHide(on: boolean) {
  useEffect(() => {
    if (!on) {
      return;
    }
    const root = document.documentElement;
    let last = window.scrollY;
    const onScroll = () => {
      // A page pulled past its top reports less than nothing for a moment.
      const now = Math.max(0, window.scrollY);
      const moved = now - last;
      if (Math.abs(moved) < NUDGE) {
        return;
      }
      last = now;
      if (moved > 0 && now > NEAR_TOP) {
        root.dataset.bars = "hidden";
      } else {
        delete root.dataset.bars;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      delete root.dataset.bars;
    };
  }, [on]);
}
