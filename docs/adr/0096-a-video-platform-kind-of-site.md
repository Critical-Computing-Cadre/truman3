# 96. A video platform kind of site

## Context

Dominic picked two video kinds of site on 2026-11-17: a short-video one (ADR 95) and one like YouTube, which he named "video platform" on 2026-11-18. On these sites people mostly watch, and what's studied is often what they're shown next: what's recommended, and what plays by itself.

Pre-roll ads are in scope too, by his answer. They need decisions of their own, so they come separately, after this.

## Decision

- **A sixth kind of site, Video platform,** with its own layout, `video`.
- **Home is a grid of thumbnails.** Each has its poster and length, then the channel's picture, the title, the channel, and the views and age. Posts on this kind have titles.
- **A video opens on its own page,** the watch page: the player, the title, the channel with a Subscribe button and its subscriber count, likes and Share, the description, and the comments.
- **The video starts as the watch page opens,** with sound, since the click that opened it counts as a tap. If the browser says no anyway, it starts muted. It keeps playing while they scroll down to the comments, as on these sites.
- **Up next runs down the side.** It's the rest of the home feed, in the feed's order, starting after this video. So what's "recommended" is whatever order the study gives the feed, and can differ by condition as feed order can now.
- **Autoplay:** when a video ends, the first in Up next starts after a five-second countdown with a Cancel button. A switch beside Up next turns autoplay off for the rest of the visit.
- **How each video was opened is recorded,** in `content.opened`'s `from`: `feed` from the grid, `upNext` from Up next, and `autoplay` when it followed by itself.
- **Subscribe is following.** It's recorded as following always is, as `actor.followed`.
- **Its look:** light, green, with a menu of sections down the left and a search box across the top. Its mark is a lens with a play mark in it. Its sample is seven NASA clips with made-up channels, credited in their descriptions and in the starter's `CREDITS.md`.

## Alternatives considered

- **A recommendation engine for Up next.** Closer to the real thing. But the study needs to know, and choose, what each participant is shown. The feed's order already does that, by condition, with the rankers and pins a study has.
- **Up next as its own list in the study's files.** More control over each video's page. It's another thing to write for every video. A study that needs it can come back to it.
- **Red, and a red play button for a mark.** It's what people picture for this kind of site. It's also one site's brand, and Truman's kinds look like a kind of platform without copying one.
- **Autoplay with no countdown.** Some sites do this. A countdown with Cancel is the common pattern, and it gives a participant a moment to choose, which is the behavior worth measuring.
- **Recording each autoplay toggle.** Not yet. What autoplay did is recorded through `from`, which is what analyses so far need.

## Consequences

- **The watch page is the post page,** so this kind has `postPages` on, and a post's comments are there, not in the grid.
- **Up next reads the home feed** each time it's shown. On a very long feed it lists the next twelve.
- **The sample adds about 15 MB of video to the repository.**
- **Pre-roll ads are still to come,** as is watching from the side while scrolling (a mini-player).
