# 34. Answering flags

## Context

Participants could flag posts and comments, and nothing came of it beyond a cover saying admins would review it. Whether a report gets answered, and how, seems worth studying. As in ADR 31, nobody real reads a flag, so the answer is written by the research team.

## Decision

- **A feature, `flagAnswers`, off in Classic and on in Forum,** which does nothing until a study writes answers.
- **An answer does one of two things:** a moderator removes what was flagged, or sends a message, such as "no rule was broken." `flag-answers.csv` and the Moderation page both write them.
- **It can name a post or comment, or be for any flag.** One naming what was flagged wins. So one post's flag can lead to removal, and everything else to no action.
- **They aren't reactions.** A reaction is about someone's nth post or comment. An answer needs to name scripted content, and to apply to every flag, which `nth` can't say.
- **Each person hears once for each thing,** the first time they flag it, even if they unflag it and flag it again.
- **A removal from a flag is an ordinary removal for that person.** It goes through `notifications`, so `loadRemovals`, the mod log, and what's refused all work the same. Since each person has their own world, flagging something removes it only for them.
- **A notification about something removed leaves out what it said,** unless it's theirs. This also protects a study from sending it back by a different route.
- **If a removal can't happen because that feature's off, the answer for any flag applies instead,** and validation warns about it.

## Alternatives

- **Adding to reactions, with a blank `nth` meaning every time.** It'd overload what `nth` means, and most of a reaction's other fields don't apply.
- **Answering every flag separately, including after unflagging.** It could look odd to be told twice about the same thing.
- **Answers to reports of a person in the same feature.** A notification has to point at a post or comment today, so those come next, on their own.

## Consequences

- With `removeFlagged` on, a flagged post is already gone from the feed, so a removal isn't noticed there. The notification still says so.
- A flagged post stays covered after a "no rule broken" answer, until they unflag it, as it always has.
- The cover's wording, that admins will review it, doesn't change, and can't be written by a study yet.
