# 40. Template looks, and dark mode

## Context

Dominic added screenshots of real platforms for each kind of template (vault note `Template looks`). He asked for templates to look and work more like them, chose Facebook and LinkedIn as Classic's models, and asked for light or dark as a study setting. Photo got its look in ADR 39. This does Classic, Forum, and Short posts.

## Decision

- **Buttons have looks: words, an icon, or both.** The layout picks one through `look`, and the feature still decides whether the button is there. An icon button keeps its words for screen readers, and shows its count beside the icon.
- **Classic is like a community feed (Facebook, LinkedIn).** A row for the count (♥ 3, then comments), then a row of buttons across the post: Like (icon and words), Reply, and the rest. Sharing moves out of More into the row. A wide screen has a right column for `side`.
- **Forum** uses an icon with the comment count, and Share with an icon.
- **Short posts** has a narrow middle column, the icon rail used by Photo, and icon buttons for reply, repost, and like. Quoting and the rest are always behind More, as on X and Bluesky.
- **`platform.theme` is light, dark, or `device`.** Light is the default. It can differ by condition. `device` follows the participant's device, as real platforms do, and changes if the device changes while they're there.
- **Dark mode redefines the colors, not each component.** Tailwind 4 colors are CSS variables. Under `html[data-theme="dark"]`, the participant app swaps white, black, and the stone grays, so every page darkens without each component knowing about it. Bright colors, like a like's red and badges, stay as they are.

## Alternatives

- **Tailwind's `dark:` classes on every component.** Each component would need a dark version written and kept up to date, and a new one would be easy to forget.
- **Dark only from the device.** Then a study couldn't hold it the same for everyone in a condition, which matters if it's part of what's being studied.
- **Copying real platforms' icons and colors.** They're recognizable, which is the point of not using them.

## Consequences

- Changed tests: the like button in Classic is now named "Like", with `aria-pressed`, rather than "♥ Like (3)". Short posts' repost button is named "Repost", with its count shown, and Quote is behind More.
- A study's logo is an image, so it doesn't change in dark mode. A dark logo on a dark page is hard to see; a study that uses dark mode should pick a logo that works on both.
- The admin app stays light.
- Still to do from the screenshots: a composer bar on Photo and Short posts, a profile with a banner and tabs, labels on posts, muting a thread, and tall story cards for Classic.
