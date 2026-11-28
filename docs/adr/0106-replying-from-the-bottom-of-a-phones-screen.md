# 106. Replying from the bottom of a phone's screen

## Context

On a post's own page, the box to write a comment was wherever the layout put it: under the post on some kinds of site, and after the last comment on others. On a phone that meant scrolling to find it, and it scrolled away again while reading. In the apps these sites stand for, the box to reply is held to the bottom of the screen for as long as the post is open. This is the third part of making a site behave like an app on a phone (ADRs 104 and 105).

## Decision

- **On a post's own page, below 768 pixels wide, the box to reply is fixed to the bottom of the screen.** It's the same box, with the same "Replying to" line and the same question when a rule asks if they're sure. `PostCard` wraps it, and each layout still places it as before on a wider screen.
- **The sections along the bottom aren't shown on that page on a phone,** nor is Short posts' round button to start a post. The page says it's a post's page with `data-page="post"`, and `skins.css` leaves them out. The arrow at the top of the page goes back to the feed, where they return.
- **Where a study has the box closed until Reply is pressed** (`commentBox`), it appears at the bottom when they press it.
- **Short video is left as it is.** Its comments already slide up on a sheet with the box at its foot (ADR 95).
- **In the feed nothing changes.** A study whose comments open under each post in the feed still has the box there.

## Alternatives considered

- **Keeping the sections, with the box above them.** One app does this. With bars that slide away while scrolling (ADR 104), the box would have to move down with them or be left floating over a gap. Most of the apps leave the sections out, and that needs no moving parts.
- **A sheet that slides up over the feed for comments,** on Photo. It's what a photo app does, and it would keep people in the feed. It needs comments loaded without leaving the page and a new record of opening them, so it's left for when a study asks.

## Consequences

- On a phone, the way from a post's page to anywhere else is the arrow back, the site's name at the top, or the phone's own back button.
- A screenshot of a post's page on a phone now always has the reply box in it.
- On iPhones the box rises with the keyboard the way Safari moves anything fixed to the bottom, which can lag a moment behind it.
