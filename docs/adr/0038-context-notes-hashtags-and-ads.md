# 38. Context notes, hashtags, what's beside the feed, muting, and ads

## Context

The rest of Short posts, from the vault note `Short posts template design`, after ADR 37. Dominic also said every template should be able to have ads and ad posts, to feel more real.

## Decision

- **Eight features.** `contextNotes`, `hashtags`, `mentions`, `trending`, `whoToFollow`, `viewCounts`, and `muting` are on in Short posts, and off in Classic and Forum. `ads` is on in Forum and Short posts, and does nothing until a study writes an ad.
- **A context note is study material,** written on a post with a time, by condition. It says "Readers added context," and no real platform's name. It's on the post wherever the post appears, including under a repost. People rate it, with one rating each that they can change, recorded as `content.note_rated`. `impressions.csv` says which note was showing.
- **Hashtags and mentions are found in the text when it's drawn,** in `textPieces` in `packages/core/src/post-text.ts`, so nothing's stored and what a study wrote stays as written. A hashtag's page is a surface, `tag`. Links are given by the page through a context, so a preview shows plain text, and a layout doesn't have to pass anything along.
- **A mention isn't checked against the cast.** A link to someone who doesn't exist says so when it's opened. A mention doesn't notify anyone, since a study can't write a participant's username ahead of time.
- **Trending is what a study writes, in order, and doesn't come from what's posted.** With a world per person, there's nothing real to count, and a study wants to control it. Each item can start at a set time.
- **Who to follow is a yes or no on someone in the cast,** and they drop off the list once followed.
- **These go beside the feed on a wide screen, and on an Explore page,** which is where a phone reaches them. Viewing it is `page.viewed`.
- **A view count is a number a study writes, plus this person once they've seen it.** It doesn't grow by itself.
- **Muting is a relation, like blocking,** recorded as `actor.muted`. It takes someone out of lists and threads, and stops notifications from them. Their own page, and a post of theirs opened directly, still work. Reposts of what they wrote go too. A moderator's decisions still arrive.
- **An ad is a post with a label a study writes,** by someone in the cast, such as a company. It can have a link, and a click is the existing `content.link_opened`. `feed.adEvery` places one after every so many other posts, with any left over at the end, in `placeAds`. Without it, ads are ordered like any post. On a profile, a post's own page, or a saved list, nothing's moved.

## Alternatives

- **Trending worked out from hashtags in what a study wrote.** It'd be surprising for a researcher, and could change when a post was edited. A study can write what it wants people to see.
- **Finding hashtags when a post's saved, and storing them.** It's a second copy of what the text already says.
- **Regular expressions typed by a researcher, or a full ad system with targeting and budgets.** Neither is needed yet. A condition can already have its own ads.
- **Removing what's left of an ad's order when there aren't enough posts.** Everything written stays, so an ad never silently disappears from what a study meant to show.
- **Letting participants write context notes.** Nobody else would see them in a world per person. It can wait for shared worlds.

## Consequences

- Short posts has no mod log by default, since its phone tabs are full, and moderation matters less to it. A study can turn it on.
- A hashtag inside a post no longer sits inside a link to the post, since browsers don't allow links inside links. So in Short posts, the way to a post's page is its comment count.
- A note on a removed post doesn't show.
- A note applies to a post, not to one repost of it.
- Comments can have hashtags and mentions linked, but a hashtag's page only finds posts.
