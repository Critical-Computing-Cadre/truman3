# 76. A look for each kind of site

## Context

The four layouts (Classic, Photo, Short posts, Forum) arrange a page differently, but they were all drawn in the same grays, with the same icons, the same box for starting a post, and the site's name in the same plain type. Side by side they read as one site with the pieces moved around. Dominic's note on the beta: "The different platforms still feel too close to each other. I want more default differences in icons, colors."

A study is meant to feel like a particular kind of platform without copying a real one: no real platform's name, logo, or exact colors (the vault note `Template looks`).

ADR 18 says a layout's look can't change once a study has launched with it. Nothing has launched for real yet (Truman 3 is in beta), so this changes the four in place. It's the last time that's possible.

## Decision

- **Each layout has a main color,** used for the site's name, links, the page someone is on, and filled buttons:
  - Classic is blue, on a cool gray page, with posts on cards.
  - Photo is a warm pink, on a white page.
  - Short posts is teal, on a white page with a hairline between posts.
  - Forum is orange, on a gray page.
- **The colors are CSS variables,** in `packages/ui/src/skins.css`, set by a `data-layout` attribute. Both apps import the file, so the builder's preview matches what participants see. Components use `text-accent`, `bg-accent-fill`, `bg-accent-soft`, and `text-on-accent` and never a layout's color by name.
  - `PlatformProvider` puts `data-layout` on a wrapper that takes up no room (`display: contents`). The participant app also puts it on the page itself, from the consent page on, so the page behind posts and any window above them take the colors too.
  - `LAYOUT_ACCENTS` in `packages/core` has the same four colors, for the builder. A test keeps it and the stylesheet in step, and checks each can be read on white.
- **A study can pick its own main color,** `platform.accent` in its settings, as `#rrggbb`. It can also differ by condition, like the light or dark setting. The builder has a color picker under **Main color**, and warns when a color is too pale to read. What's written on top of a filled button is black or white, whichever stands out more.
- **In the dark,** the main color is lightened for words and icons, and left as it is for filled buttons.
- **Things other than color differ too:**
  - Liking is a thumb on Classic, and a heart elsewhere. Votes are arrows, orange for up and blue for down. A repost turns green.
  - New notifications are under a heart on Photo, and a bell elsewhere. A forum's tabs on a phone have icons.
  - Icons are drawn with finer lines on Photo than on Forum.
  - The bar that starts a post is "What's on your mind?" on Classic, a small "New post" button on Photo, "What's up?" with a Post button on Short posts, and "Create a post" with a pen on Forum. To a screen reader, and to tests, it's one button named "Create a post" on all four.
  - Where a study has no logo, the site's name is drawn differently on each: a letter in a blue square on Classic, a gradient in a serif italic on Photo, plain teal on Short posts, and a lowercase name beside a letter in an orange circle on Forum.
- **The sample content is lived in.** Each starter in `studies/starters` now has profile photos, real photos in posts, more posts, and more comments. The photos come from the EatSnap example, which Dominic approved for reuse.

## Alternatives considered

- **A theme object in each study's settings,** with every color and shape. More than a researcher wants to decide, and every option is another thing that can differ between two labs' "same" study. One color covers what people asked for: matching a logo, or telling two of a lab's studies apart.
- **Using real platforms' colors.** Rejected already: a study should feel familiar, not pass itself off as someone else's product.
- **New layout names (`classic-2`, and so on),** as ADR 18 asks once studies have launched. Not needed yet, and it would leave four layouts nobody uses.
- **Web fonts for each layout.** A font is a strong signal, but it's a request to someone else's server from a participant's browser, or files to host. The system's fonts are used, with weight, case, and italics doing the work.

## Consequences

- From here on, ADR 18 holds: a change to how a layout looks, once a study has launched with it, needs a new layout name.
- A component that wants "the site's color" uses the accent classes. A sky or stone class for a button or link would look right on one layout and wrong on three.
- A study that sets a pale main color gets pale links. The builder warns, and doesn't refuse.
