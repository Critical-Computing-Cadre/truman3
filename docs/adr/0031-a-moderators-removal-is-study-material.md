# 31. A moderator's removal is study material

## Context

This is the first piece of Forum part 3, from the vault note `Moderation design`. A world per person means nobody real moderates anyone, so what a moderator decides is written by the research team, like posts and reactions, and can differ by condition. Warnings, a mod log, and the builder's screens come in later PRs.

## Decision

- **One feature, `removal`, off in Classic and on in Forum.** It does nothing unless a study writes removals. Its description says that telling a real person they broke a rule is a deception for an IRB and a debriefing. Truman doesn't decide that for anyone.
- **Two ways to write one, matching how each kind of content is already scripted.** What the study wrote goes in `removals.csv`, with a set time relative to the start. What a participant wrote is a new reaction type, `remove`, in `reactions.csv`, on their nth post or comment, whose `body` is the reason.
- **A moderator is anyone in the cast.** There's no separate idea of who decides. A study wanting "automatic" removal writes an account with that name.
- **Nothing runs later, and nothing is deleted.** As with reactions, a removal counts once it has come due, so it's worked out each time from a time and the row. `loadRemovals` in `apps/api/src/feed/build.ts` is the one place that says what's been removed. The text stays in the database, so a researcher still has it, and withdrawal still deletes it.
- **A removed post keeps its place, its author, its space, and its comments, and loses everything it said.** A note takes its place, with the moderator's name and any reason. The server sends none of its title, text, photos, link, poll, flair, tags, or crosspost, so it can't be read from a response. On its author's screen it stays as written, with a note saying nobody else can see it.
- **A removed comment's replies stay,** so a thread keeps its shape.
- **The server refuses liking, voting, flagging, commenting, poll votes, and crossposting on something removed,** and commenting anywhere under it. Saving, hiding, and copying a link still work, since they don't add to it, and someone needs to be able to unhide a post that was removed after they hid it.
- **A crosspost of a removed post says the original isn't available,** as it does for anything else someone can't see.
- **`impressions.csv` says what was on screen,** in `removed` and `removed_comment_ids`, since the same post can be there at one moment and removed the next. A scripted removal isn't an event, like any scripted content appearing on schedule (ADR 6). A removal of what a participant wrote is `reaction.scheduled`, with its reason, because it's triggered by what they did. `removals.csv` in an export lists what a version removes.

## Alternatives

- **Silent removal, where the author sees their post as normal and others don't.** The design note listed this. With a world per person nobody else sees a participant's post, so it would change nothing on anyone's screen. It waits for shared worlds. A study wanting something close can write no reactions to that person's posts.
- **Taking a removed post out of lists.** It's closer to how some forums behave, but a bystander can't notice what isn't there, and noticing is what these studies are likely to measure.
- **Keeping a removed post's title.** Some forums do. It would let someone read what was removed, which works against a study that's testing what people make of a removal. It's one line to change if a study wants it.
- **Columns on `content` for a removal.** A study couldn't then remove something in one condition and not another, or differently in each.
- **A new table for removals of what participants wrote.** `notifications` already holds what a scripted actor did and when it comes due, goes with the world on withdrawal, and is what tells the participant.

## Consequences

- A removal only exists in study files and packs for now. A researcher in the builder can't write one or see one in the preview, and the builder keeps them when it saves a new version. Deleting a post or comment deletes any removal of it.
- Reactions due after a removal still happen. A scripted like on a removed post still arrives, unless the study doesn't write one.
- What someone sees now depends on what they wrote and when, so comparing conditions needs `impressions.csv`. The codebook says what's recorded.
- `FeedPost` can have an empty body and no title, which layouts already handled, since a post can be only a photo.
