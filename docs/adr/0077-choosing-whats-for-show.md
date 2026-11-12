# 77. Choosing what's for show, and recording presses on it

## Context

ADR 76 gave each kind of site what a real one has around its posts: menus, small print, a search box, a place for messages. Most of it was for show. After trying it, Dominic asked for three things: record a press on any of them, make real whichever can be, and let a researcher see the whole list for their kind of site, hide any of it, and add their own.

## Decision

- **Every for-show thing is in one list,** `DECOR_ITEMS` in `packages/core`, by layout. Each has a key, the words on it, where on the page it is, and, for some, the real page it can open.
  - A layout draws one with `<Decor id>`, and the small print is drawn straight from the list.
  - A test renders each layout and checks that what it draws is exactly what its list says. So the builder's list can't drift from the page.
- **Where a study has the real page, the item opens it** and is no longer for show: Groups opens Communities, Saved and Bookmarks open the participant's own page, Settings and More open the page for editing a profile, Friends and Popular open Explore, and Rules, Terms, and Privacy open the study's own pages. The search box and the messages corner already worked this way.
- **A press on something for show is recorded** as a `decor.pressed` event, with its key, the words on it, and the page they were on. The browser reports it with page views, on the same route.
  - A real link isn't recorded as `decor.pressed`. The page it opens is recorded as a page view.
- **A study chooses what's shown,** in `platform.decor`:
  - `hide` is a list of keys to leave out.
  - `add` is up to 8 things of the study's own, each a short name. They go in the layout's menu, with the first letter as the icon, and do what the rest do: say they aren't available, and get recorded, under `added-<name>`.
  - The builder's Settings page lists them under **What's shown for show?**, grouped by where they are.
- **It's a setting for the whole study, not for a condition.** The `decor` feature itself can still be on in one condition and off in another.

## Alternatives considered

- **A free-form list a researcher writes from scratch,** with a place and an icon for each. More to decide, and most studies want "a normal-looking site" more than they want to design a menu. The list is there to prune and add to.
- **Letting an added item open a page or a link.** That's a real feature with real content, which a study already has: a page in the flow, or a link post. Something added is for show.
- **Removing everything that isn't real.** The page goes back to looking empty, which is what ADR 76 set out to fix.
- **Recording presses through a route of their own.** They change nothing on the server, so they belong with the other things a browser reports.

## Consequences

- A new for-show thing in a layout has to be added to the list, or the test fails.
- Hiding by condition isn't possible. If a study needs it, `decor` would move into what a condition can override.
- A study that hides the search box still has it where it really looks something up, because then it isn't for show.
