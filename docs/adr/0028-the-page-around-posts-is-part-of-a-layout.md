# 28. The page around posts is part of a layout

## Context

Forum part 1 (ADR 27) changed how posts look, and kept Classic's header and profile card, which limited how different a template could be. This is the first half of part 2 in the vault note `Forum template design`.

## Decision

- **A layout now also arranges the page.** `packages/ui/src/layouts/*-page.tsx` have a header, and frames for a feed, a space, and a post. Pages hand over pieces, such as a profile card or a rules list, and a layout decides where each goes, or leaves it out. Classic keeps its arrangement and markup.
- **Forum's page:** a top bar, tabs along the bottom on a phone, and on a big screen a column beside posts for a compact profile, communities, and what a community is. A space's rules are folded on a phone, so they don't push its posts down.
- **Changed in place, once.** ADR 18 says a launched layout's look can't change. No real study has launched `forum`, which is days old, so this changes it rather than adding `forum-2`. From now on the rule applies.
- **Member counts are written by a study,** as `members` in `spaces.csv` or on the builder's Spaces page. A participant sees that plus one while they're in it, since they're the only person in their world. With no number written, none shows, so existing studies don't change.
- **Four more feed orders and three more comment orders:** `hot`, `best`, `rising`, `controversial` for posts, and `best`, `controversial`, `old` for comments. They're in `packages/feed/src/scores.ts`, with versions, and the same inputs give the same order. Each showing records its order, and a ranker's score for each post.
- **These orders are ours.** They're inspired by what forums tend to have, but I can't check any real platform's formulas, and those change. The codebook says how each is worked out, and says not to report them as a real platform's. `best` is the lower bound of the Wilson score interval at 95%, which is a standard statistic. The rest are plain arithmetic chosen to behave sensibly.
- **Scripted karma changes are a list in the study's settings:** `platform.karmaChanges`, each with `afterMinutes`, `change`, and `actor`, a username, left out for the participant. A condition's list replaces the study's. They're frozen with a version, and timed from when each participant started. The builder edits the study's list, and study folders can also set one per condition.
- **What was shown is recorded,** as `karma_shown` on each showing, since it can no longer be worked out from what was written alone. A participant is `viewer` there, because their username could identify them.
- **Notifications link to what they're about,** on a platform with a page for each post, and to the comment on that page. Opening one is recorded with `from: notifications`.
- **The researcher's preview follows the same rule as the participant's list.** On a platform with `postPages`, a preview lists posts and opens one to show comments. The draft editor still shows comments under posts, since that's where they get edited.

## Alternatives

- **Cast karma moving with votes.** Only one person votes in each world, so it would barely move. A scripted change says what a study means directly.
- **Reddit's formulas, as they've been described publicly.** They'd invite people to report results as Reddit's order, which can't be true.
- **A separate table for karma changes.** Settings are already frozen with a version and already reach the builder.

## Consequences

- Classic's `<li>` for a comment gained an `id`, for notification links. Nothing else about Classic changed, and its pages now go through the same frames.
- A layout has more to write. A new template needs a header and three frames, or can reuse another layout's.
- Member counts can't be shared across people until worlds are shared, when they'd count everyone in the world.
- All of someone's space pages still share one chosen order, and all their post pages share one comment order.
- A chosen order can be `hot` on a feed with no votes written, where everything scores zero and ties go to the newer, so it looks like `new`. A study should write votes if it offers these.
