# 47. Stories open in a window, and stay dark

## Context

Dominic found that stories looked like a separate page, with a small photo, and turned light in a dark-mode study. Dark mode (ADR 40) works by swapping the theme's colors, so `bg-black` becomes white and `text-white` becomes near-black. The viewer used those, so dark mode turned it inside out. He asked for a window over the page, as on Instagram.

He also found Short posts' menu covering a post at a medium width. The menu is fixed down the left, and only the feed made room for it, so a post's own page slid under it.

## Decision

- **A story is a 9:16 card over the dimmed page,** with arrows beside it, as on Instagram on a computer. On a phone it fills the screen, and the arrows sit on its edges. Clicking outside the card closes it, as do Escape and ×.
- **The viewer's colors are written out, like `bg-[#000]`,** so the theme can't swap them. It's dark in light and dark mode alike, as these platforms' viewers are.
- **The photo is shown whole, over a blurred copy of itself,** so a landscape photo isn't cropped to fit a tall card.
- **A bar fills over the five seconds a story shows,** and the viewer moves on when it's full. Pause stops the bar and the timer together. The arrow keys move between stories.
- **Tapping a third of the card goes back, and the rest goes on.** The tap areas are hidden from screen readers, since the arrows do the same and have names.
- **Every page of a layout with a rail makes room for it.** Each layout has a `Body` in `PageFrames.tsx`, which the participant app wraps every page in. The rail shows words only once it's wide enough for them.

## Alternatives

- **Opting the viewer out of dark mode with a class that restores the theme's colors.** Every color would need copying from Tailwind, and they'd drift.
- **Cropping a photo to fill the card.** It looks more like Instagram, but cuts off what a study chose to show.
- **Each page adding its own room for the rail.** That's how the feed did it, and it's how a post's page was missed.

## Consequences

- Anything else that must look the same in both modes, such as a photo viewer, should write out its colors the same way.
- What's recorded about a story hasn't changed: how long it was shown, and how it ended. Time spent paused counts toward how long it was shown.
