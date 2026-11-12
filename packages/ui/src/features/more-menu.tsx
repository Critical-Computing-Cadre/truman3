import type { FeatureKey } from "@truman3/core";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { DotsIcon } from "../icons.tsx";
import { useIsPhone, usePlatform } from "../platform.tsx";

/**
 * On a phone, what would wrap a row of buttons onto several lines goes behind a "More" button, which
 * opens them in a row below. Everything stays reachable, by touch or keyboard, and on a wider screen
 * nothing changes. A layout says where the button and the row go. Nothing happens without one of
 * these features, so a platform that doesn't have them looks as it always has.
 */
export function useMoreMenu(
  features: readonly FeatureKey[],
  buttonClassName: string,
  /** Behind "More" on every screen, as some platforms keep them, not only on a phone. */
  always = false,
) {
  const platform = usePlatform();
  const phone = useIsPhone() || always;
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);

  // Three dots where the buttons beside it are icons, and the word where they're words.
  const dots = platform.layout === "photo" || platform.layout === "short-posts";
  const collapsed = phone && features.some((feature) => platform.features[feature]);
  return {
    /** Whether the buttons are behind "More", rather than in the row. */
    collapsed,
    open: collapsed && open,
    toggle: collapsed ? (
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className={buttonClassName}
        {...(dots ? { "aria-label": "More" } : {})}
      >
        {dots ? <DotsIcon className="h-5 w-5" /> : "More"}
      </button>
    ) : null,
    panelProps: {
      id,
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          setOpen(false);
          button.current?.focus();
        }
      },
    },
  };
}
