# 29. Links, pins, locks, tags, saving, hiding, and sharing

## Context

This is part of Forum part 2 in the vault note `Forum template design`. Dominic asked for Forum to be as complete as Reddit. Polls, flair, and crossposting are the rest of this part, in a later PR.

## Decision

- **Eight small features, all off in Classic:** `links`, `pinning`, `locking`, `spoilers`, `adultTags`, `saving`, `hiding`, and `sharing`. All are on in Forum except `adultTags`, which a study has to turn on, and whose description says to talk to an IRB. There's no age check.
- **A title can be a whole post.** So can a link. On a photo platform, a post still needs a photo. This raises `titles` to version 2.
- **The server never fetches a link.** It would let anyone who can write a post aim the server at other addresses. So there are no previews, and a researcher who wants a picture adds one. Only `http` and `https` are accepted, with no login in the address, wherever a link can be written. It opens with `rel="noopener noreferrer nofollow"`, so the other site learns nothing about the study from the referrer, and a click is recorded as `content.link_opened`.
- **A pin belongs to a list.** A post names `home`, `space`, or both, so one pinned in its community isn't also on top at home. It's on top even outside a feed's time window. Researchers set pins and locks. The recorded `pinned` column in `impressions.csv` was already there.
- **A lock is enforced by the server,** on comments and replies to them. What's already there stays.
- **A covered post isn't on the page until it's clicked,** so an image doesn't load. Each uncovering is recorded with what covered it. It covers again on another page, so `content.revealed` can repeat. Someone editing in the builder sees it uncovered.
- **Saved and hidden are per person,** in `content_interactions`, with events. Hidden posts leave feeds, space pages, and profiles, and so leave `feed_impressions`, which only lists what was shown. `content.hidden` is what says why a post is missing. They still open by their own page, and each person's lists are on their own profile.
- **Sharing copies a link to a post's own page, and can't leak anything.** The link only has a post's ID. Opening it uses the same check as everything else: someone needs a session, and it has to be a post they can already see. Someone else's post is in another world, so it answers 404, and a stranger gets nothing. A scripted post opens as the reader's own copy, with none of the first person's actions. Nothing records whether a link was opened by anyone else, because a link has nothing in it to say who sent it. With `sharing` on, a post's page works even without `postPages`.

## Alternatives

- **Link previews fetched by the server.** See above. A preview could also change during a study.
- **Recording who opened a shared link, with a token in it.** It would tie one participant's activity to another's, which a study hasn't asked for and an IRB might not expect.
- **A separate table for hidden posts in impressions.** It'd say the same thing as the events, in a second place.
- **Pins that apply everywhere.** A community's announcement doesn't belong on top of someone's home feed.

## Consequences

- Classic's layout gained these components, which draw nothing when off, and three features were added to its check for showing the row of buttons.
- A hidden post isn't in an impression even if the same list would have shown it, so comparing what different people saw needs `content.hidden` too.
- Copying a link can fail, as on an address without HTTPS. The button says so, and nothing is recorded.
