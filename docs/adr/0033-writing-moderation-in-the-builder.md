# 33. Writing moderation in the builder

## Context

ADR 31 and 32 left a moderator's decisions in study files. Researchers who don't use files need to write them, and Dominic has said people shouldn't need a terminal to build a study.

## Decision

- **A Moderation page, beside Cast and Spaces,** shown when removals or warnings are on in some condition. It has two lists: removing what the study wrote, and responding to what a participant writes. Each saves as it's edited, like everything else in a draft.
- **They're ordinary draft items,** `removal` and `reaction`, so history, packs, and saving a version work as they do for anything else. A removal can only point at a post or comment in the draft, of the kind it says.
- **A removal goes along with what it removes.** Deleting a post deletes its removal, and moving a post on the timeline moves its removal by the same amount, as it does for comments.
- **The feed being edited doesn't apply removals.** A removed post would have no text, and couldn't be edited, so it stays whole with a label saying when it's removed. A saved version's preview does apply them, so it's what a participant sees. Removals of what a participant writes aren't in either, since nobody's written anything.
- **Only moderators' responses have a screen.** A scripted like or reply stays in files for now, and isn't changed or shown here.
- **Someone's "first post" is what's on screen, stored from 0,** the same as `nth` in `reactions.csv`.

## Alternatives

- **Removing from a post's own details in the feed.** It's where someone would look, but responses to what participants write have no post to hang from, and two places to write these would be harder to explain.
- **Showing the removed note in the feed being edited.** It's closer to what participants see, at the cost of not being able to edit the post at that time.

## Consequences

- The time slider in the editor doesn't show a removal happening, only the label. The version's preview does.
- Someone looking at the Moderation page sees reactions of two types only, even if a study from files has others.
