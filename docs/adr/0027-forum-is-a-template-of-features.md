# 27. Forum is a template of features

## Context

Forum is the second template, and the test of ADR 18: a platform very unlike Classic, built from the same blocks. Dominic's answers are in the vault note `Forum template design`. He asked for Forum to be as complete as Reddit, so this is part 1 of several, in the note's section 6.

## Decision

- **Three new features, all off in Classic:** `titles`, `postPages`, and `karma`. A template names them, and a study can mix them. Classic can have titles and post pages, and Forum can keep comments under its posts.
- **`forum` is a new layout, cards in the style of a modern forum.** It only arranges what features provide, with no `if` about what a feature does. It looks like no real platform, and has no real platform's name, logo, or colors.
- **Comments moving to a post's own page is a feature, not a layout.** The server leaves them out of a list when `postPages` is on, and doesn't record them as shown there, so `comment_ids` in `impressions.csv` means what it says. A list sends a count.
- **A post's page is a surface, `post`.** Viewing it is recorded separately from the list, in `content.viewed` and `feed_impressions`. Opening it is `content.opened`, with `from` saying which list it came from, or `direct` if nothing did, as after a reload. The record is sent when the page opens, not when the feed loads, since the feed reloads after every vote.
- **Comment order works like rankers, in `packages/feed/src/comment-orders.ts`:** `scripted`, the time written, `top`, and `new`, each with a version recorded on every impression. They only order comments with the same parent, so a reply stays under what it replies to. Leaving it out means the template's, then `scripted`, which is what Classic has always done. It's copied in when a version freezes.
- **Participants choosing a comment order is a setting, off by default,** stored the same way as a feed's: the latest `comments.sort_changed` sets it, with no second copy.
- **Karma is a number.** Someone in the cast has what the study wrote. A participant has `platform.startingKarma`, zero by default, plus scripted votes that have happened on what they wrote. Their own votes don't count. Karma isn't sent to a browser when the feature's off. Dominic has an open question on this, and all of it is in `participantKarma`, so it's easy to change.
- **A community's look is set values, not CSS:** a banner image and an accent color. Dominic has an open question on this too. Nothing a researcher can write runs on a participant's screen (ADR 18). An accent has to be `#rrggbb`, which the schema enforces before it can reach a style. Any color is allowed, because what goes on it is black or white, whichever reads better, which always reaches 4.5 to 1 (`packages/core/src/color.ts`). It's only ever a fill. Nothing is written over a banner.
- **A study keeps the template it starts with.** It's chosen on the New Study page, and a save can't change it, since what's written depends on it. Features can still change in Settings.
- **A template can also say what a study starts with,** in `feed`. Forum starts with `top` for posts and comments.

## Alternatives

- **Comments on their own page as part of the forum layout.** The layout would need the server's help, and Classic couldn't have it. It would also have been the `if` that ADR 18 says belongs in a feature.
- **Recording that a post was opened when its feed is requested.** Every vote reloads the feed, so one visit would count many times.
- **Letting researchers write CSS for a community.** It's what old Reddit did, but it could hide buttons, or break a study's measurements, with no way for the platform to notice.
- **Refusing colors that are hard to read.** Choosing the text instead lets a study use any color it wants.

## Consequences

- Existing layouts gained three small components, which return nothing when their features are off.
- The researcher's preview shows comments under posts in Forum, since that's where they get edited. So the preview isn't quite what a participant sees.
- Karma can't move for someone in the cast during a study, including when a participant votes on what they wrote. With a world per person, moving it would mean little.
- `content.opened` counts each arrival, so a reload counts again, as `direct`.
- Orders beyond these three, link posts, polls, flair, saving, hiding, sharing, pinning, locking, search, member counts, and moderators' actions aren't here. They're parts 2 and 3 in the note.
