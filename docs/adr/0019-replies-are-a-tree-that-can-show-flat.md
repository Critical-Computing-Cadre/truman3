# 19. Replies are a tree that can show flat

## Context

The Forum template needs replies to replies. A study may also want threads as a manipulation: the same comments, nested for one condition and in one list for another.

## Decision

A comment's `parent_id` is what it replies to, either a post or another comment. There's no new database column, and `threads` is a feature like any other, off in Classic.

- **Off means flat, not hidden.** The same comments show in time order, so the content doesn't differ between the conditions, only how it's arranged. Validation warns that replies will show flat.
- **A reply is hidden with what it replies to.** If a comment is flagged away, blocked, in another condition, or hasn't appeared yet, its replies don't show. This holds with threads off too, so turning threads off changes only the arrangement. Validation warns when a reply is in a condition its comment isn't.
- **The feed sends a flat list with a depth,** not nested objects. A layout draws a list and indents it, and one rule decides the order, in `assembleFeed`.
- **Scripted replies follow the condition.** With threads, one goes under the participant's comment. Without, it goes on the post, as before.
- **Threads stop at 16 levels,** and indenting stops at 4, since a phone has no room for more. The limit also bounds the work of checking a thread when someone replies.

## Alternatives

- **A `post_id` column on every comment.** It makes finding a comment's post one lookup, but it's a second copy of something the parents already say, and they could disagree. Feeds load a world's content at once, so walking up costs little.
- **Hiding replies when threads are off.** A study comparing the two would then show different content in each condition, and the comparison wouldn't be about threading alone.
- **Showing replies whose comment is hidden.** A reply makes little sense alone, and participants could work out that something was removed.

## Consequences

Analysis has to treat `parent_id` as possibly a comment. `content.csv` in an export includes `parent_id`, and impressions record which comments were shown, but not their depth, which comes from `parent_id` and whether the condition had threads.
