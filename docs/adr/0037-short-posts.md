# 37. Short posts, following, reposts, and quotes

## Context

The third template, like X or Bluesky, from the vault note `Short posts template design`. Dominic wants it as complete as the others, and it should test whether a new template gets faster to build. This is part 1. Part 2 has community-written context, hashtags and mentions, trending, who to follow, view counts, muting, and ads in every template.

## Decision

- **Five features, off in Classic and Forum:** `followingFeed`, `followCounts`, `reposts`, `quotes`, and `badges`. A template names them, and a study can mix them.
- **`shortPosts` is a template, with a `short-posts` layout for its posts.** Its page uses Forum's frame for now. Dominic wants templates to look very different and more lived in later, so that's when it gets its own.
- **The following tab is a surface, `following`,** recorded separately. Its order is `feed.followingRanker`, newest first unless set. A study can rename both tabs, and choose which one someone starts on.
- **Who someone starts out following is written on the cast,** for everyone or by condition, and becomes ordinary follows when they enter. After that it's theirs to change. It isn't an event, since nobody did anything, and `impressions.csv` shows what came of it.
- **A repost is a row in `content`,** pointing at what it passes along, which can be another repost. So a study writes a story spreading through a network as ordinary posts with times, and a chain keeps who it came through. This is what Dominic asked for.
- **In a list, a repost is shown as the post it passes along, under the reposter's name.** Likes, replies, and links all go to that first post, since that's how these platforms work. `feed_impressions` lists the repost, and `content.viewed` names the first post. The codebook says so.
- **A repost of something someone can't see doesn't show at all,** rather than saying it's unavailable. A quote says so, since its author's words are still there.
- **A participant's repost always points at the first post,** and taking it back deletes it, with both recorded as events. Reposts don't count as someone's nth post, so scripted reactions to their writing aren't set off by it.
- **A quote is a post with `quote_of`,** going through the same route as any post, so its length limit, automatic rules, and scripted reactions work with nothing added.
- **A length limit is `platform.maxPostLength`,** with none by default, and applies to what participants write, in posts and comments. A researcher's own writing isn't refused, as a study may want that, but validation warns.
- **A badge is a label a researcher writes** on someone in the cast. It's no real platform's check mark.
- **Scripted reactions gain `repost` and `follow`,** so someone in the cast can pass along or follow a participant.

## Alternatives

- **Reusing crossposts for quotes.** A crosspost belongs to a community, and has rules about that which a quote doesn't. They share how the original is checked, in `originalOf`.
- **A repost as an interaction, like a like.** It couldn't be scheduled as study material, or sit in a list at its own time, or make a chain.
- **Showing a repost as its own post with the original inside.** It's simpler to build, but it isn't how these platforms look, and a like would go to the wrong place. The feed being edited does show them that way, so a researcher can edit one.
- **A second order and second copy of a post's counts on each repost.** Counts belong to the first post, so they stay the same wherever it appears.

## Consequences

- Following now means something, on any template with `followingFeed`.
- With `postPages` off, a repost doesn't list its comments under it, only a count. Short posts has it on.
- The feed being edited shows a repost as its own card, with the post it passes along inside it. A saved version's preview shows what a participant sees.
- A scripted repost's own `conditions` and the original's both apply.
- A participant has no way to see who reposted something, only how many did.
- Nothing shows whether a participant's own followers changed, except the count and a notification.
