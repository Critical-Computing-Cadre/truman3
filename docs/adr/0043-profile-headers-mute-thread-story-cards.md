# 43. Profile headers, muting a thread, and story cards

## Context

What's left from Dominic's screenshots of real platforms, from the vault note `Template looks`, section 5. Labels on posts wait for his answer there.

## Decision

- **A profile's header belongs to the layout,** like the rest of the page around posts (ADR 18). `ProfileHeader` picks one, and the profile page hands it the pieces.
  - Classic and Forum keep the centered card.
  - Short posts gets a banner with the picture overlapping it, then the name, handle, counts in a row, and bio.
  - Photo puts the picture on the left, the username and buttons beside it, counts in a row, then the name and bio.
- **Anyone in the cast can have a banner,** as `banner` in `actors.csv`, a picture in `media/actors`. Without one, it's a plain gradient. Participants don't have one, and the builder can't set one yet.
- **A profile shown as a list gets a Media tab,** of posts with photos. A grid of photos already is that.
- **`threadMuting`: participants can mute a thread** from a post's menu. It stops notifications from the cast about that post and everything under it: reads, likes, replies, reposts, and tags. A moderator's decisions still come through, as with muting a person. It's an interaction, `mute_thread`, with events `content.thread_muted` and `content.thread_unmuted`. On in Short posts only.
- **A layout says how stories show.** Classic shows them as tall cards, as on Facebook, if a study turns stories on there. The others keep circles.

## Alternatives

- **Choosing a profile's look on the profile page.** That puts a layout's decisions in a page, which ADR 18 keeps apart.
- **Muting a thread by hiding its replies.** Bluesky only stops notifications, and hiding replies would change what a study shows.
- **Counting unread notifications by grouping,** as the list does, so a muted thread is left out the same way. That would change what the unread count means. It still counts rows, and only reads each notification's post when someone has muted a thread.

## Consequences

- `content_interactions` takes a new kind (migration `0037`).
- There's no Replies tab on profiles yet. It needs a list of someone's replies with what they replied to.
- The profile page no longer draws its own header, so a new layout has to name one.
