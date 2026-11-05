# 36. Automatic rules, holding for review, and appeals

## Context

More of Forum part 3, bundled as Dominic asked. Dominic also answered that recording text someone chose not to post should be a separate setting, off by default. A language model deciding comes with agents, through the same steps. This is words only.

## Decision

- **Two features, `autoRules` and `appeals`, off in Classic and on in Forum.** Each does nothing until a study writes some.
- **A rule looks for words and phrases, separated by `|`, whole words only, ignoring case. One ending in `*` matches the start of a word.** It's in `auto-rules.csv` or on the Moderation page, which has a box to try a sentence against it, using the same code as the server (`packages/core/src/auto-rules.ts`). The design note said a team has to be able to test what a rule catches.
- **No patterns of a researcher's own.** A badly written regular expression can hang a server on what someone typed, and anyone with builder access could write one. Everything a researcher writes is treated as plain text.
- **A rule does one of four things:** asks if they're sure before it posts, holds it for approval, removes it, or warns them. It names a moderator, who can be an account named as automatic.
- **The first rule that matches applies, in the order written,** with one exception: a rule asking if they're sure and a rule that acts can both apply to the same post. So a study can ask, then remove it anyway.
- **Asking happens before anything's stored.** The server answers with the question, and nothing's posted until they send it again saying they've seen it. No photo is uploaded until then either.
- **What they do is recorded,** in `moderation.rule_fired` and `moderation.confirm_answered`. Someone who closes the page has neither answer.
- **Text someone doesn't post is only kept if `platform.recordUnpostedText` is on, and it's off by default.** It's a setting in Settings, which says to raise it with an IRB. It goes in `moderation.rule_fired`, and withdrawal deletes it with their other events.
- **A hold is two rows in `notifications`:** one that says it's waiting, due when it's decided, and one for how it ends. While the first hasn't come due, the post shows as waiting to its author. As with everything else here, nothing has to run later.
- **Reactions wait for a hold, and don't happen if it ends in removal,** since nobody could have seen it to react.
- **A participant can appeal a removal of what they wrote, once.** It's only for what's theirs. What they write is in `moderation.appealed`. The answer either keeps the removal or puts it back, and a notification says which. With no answer written, they get none, which a study may want.
- **A `restore` undoes a removal in `loadRemovals`,** so what's on screen, the mod log, and what's refused all follow.

## Alternatives

- **Researchers writing regular expressions.** See above. A safe engine would be a new dependency, and no study has needed more than this yet.
- **Rules firing together.** A post caught by several would get several responses, which is hard to predict from a list, and harder to analyze.
- **A hold keeping a post out of someone's own list.** With a world per person, they're the only one who could see it, and it would seem to vanish.
- **Keeping appeals in their own table.** It'd be a second place for what events already hold, and something more for withdrawal to remember.
- **Appeals of warnings.** A warning changes nothing to undo, so an answer has less to do. It could come later.

## Consequences

- A crosspost isn't checked, since it's what someone else wrote. Its new title isn't either.
- A word list can catch someone disclosing something serious. The feature's description says so, and nothing here tries to detect that.
- A confirmed post sends the rule's ID back from the browser. Someone tampering could skip being asked, but it only skips the question, and nothing's gained by doing so.
- A held post can still be voted on and commented on by its author, as nobody else can see it.
- `moderation.appealed` holds free text in the event log, which the codebook says to treat as sensitive.
