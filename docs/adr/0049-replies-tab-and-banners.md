# 49. A Replies tab, and banners from the builder and participants

## Context

ADR 43 gave Short posts a profile with a banner, and left three things for later: setting a banner in the builder, a banner for participants, and a Replies tab, as Bluesky has.

## Decision

- **A Replies tab on profiles where replies are on a post's own page:** Short posts and Forum, as on Bluesky and Reddit. Classic shows comments under each post already, and Photo's profile is a grid.
- **It lists the posts someone replied to, with only their replies,** newest post first, as a list on its own surface, `replies`. Their replies are shown even though comments otherwise wait for a post's page, since they're what the tab is for. It's off when comments are.
- **The whole thread is used to place each reply, then only theirs are kept,** each shown on its own rather than in its thread. A reply to a reply would otherwise be lost when what it answers isn't theirs.
- **A banner can be set for anyone in the cast on the builder's Cast page,** where some condition uses Short posts. It's stored like any other picture, and can be taken off.
- **A participant can add a banner on their Edit profile page** in Short posts. It's stored with their other uploads, so withdrawal deletes it, and it's listed in the photo download as `banner`.
- **The codebook now lists every surface** an impression can come from, which had fallen behind.

## Alternatives

- **Showing each reply in its thread.** It's closer to Bluesky, but the tab would mostly be other people's words.
- **Ordering by when they replied.** The feed's orders are by post, and a new one for this wasn't worth it yet.

## Consequences

- The Replies tab is recorded in `impressions.csv` with surface `replies`, and `comment_ids` lists only their replies.
- A banner set for someone in the cast stays in the draft if the study's layout changes, and shows again if it changes back.
