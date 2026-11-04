# 30. Polls, flair, and crossposting

## Context

This finishes Forum part 2 in the vault note `Forum template design`. ADR 29 covers the rest of that part. Seven buttons had also started wrapping onto two rows on phones.

## Decision

- **Three features, off in Classic and on in Forum:** `polls`, `flair`, and `crossposting`.
- **A poll is one choice, once.** It has 2 to 6 options. A study sets each option's starting votes, and whether results show before someone votes. The server doesn't send counts until they're allowed, so hiding them can't be got around by reading the response. A row in `content_interactions` holds the choice, and its key allows only one, so two votes at once can't both count. `content.poll_voted` says which option, by its place in the list. A lock stops comments and not votes. Participants' own polls start at zero, and show results after voting.
- **Flair belongs to a space.** Each space has a list for posts and a list for people, and can require flair on posts a participant writes. Participants choose from the lists and the server refuses anything else. A flair is known by its text, so the builder adds and removes it rather than renaming it, and a post left with one that's gone fails validation. Scripted posts can skip a required flair, with a warning, since that's a design choice. Someone can only choose their own flair in a space they've joined, and `space.flair_chosen` records it.
- **A crosspost is a new post.** It has its own votes, comments, and space, and `content.crosspost_of` points at the original. A participant can only crosspost what they can see, into a space they've joined, and not into the space it's already in. It needs `posting` and `spaces` too. It takes the original's title unless they write one. It counts as one of their posts, so scripted reactions to their nth post apply. A crosspost of a crosspost points at the first post, so there's never a chain. Validation holds scripted crossposts to the same rules.
- **What a crosspost shows is checked each time it's shown.** If this viewer can't see the original, because of its condition, time, space, or a block or flag a study removes, it says the original isn't available and sends nothing of it. A tag on the original also covers the crosspost, and uncovering it records both.
- **On a phone, less-used buttons go behind "More".** It opens them in a row below rather than a floating menu, since a card clips what floats, and it needs no special keyboard handling apart from Escape. Forum puts flagging, saving, hiding, sharing, and crossposting there, and Classic the four it doesn't already show, so Classic without them is unchanged. Whether it's a phone comes from the browser, because the same buttons shouldn't be drawn twice.

## Alternatives

- **A separate table for poll votes.** It would need its own deletion and grants for what one column does.
- **Flair with a key separate from its text.** It would allow renaming, for more to write in a spreadsheet, and renaming during a study would change what the data means.
- **Copying the original into a crosspost.** Withdrawal and conditions are simpler with one post pointed at, and what's shown can't drift from it.
- **Recording a view of the original inside a crosspost.** `feed_impressions` lists what was placed in a list, and the original wasn't. The codebook says so.

## Consequences

- With `crossposting` off, a crosspost shows as an ordinary post, with whatever title it has, and validation warns about it.
- `delete_participant_data` needed no change. Votes and flair go with the world, and a participant's crosspost goes with their content in one statement, which satisfies the reference.
- A phone's first row has fewer buttons, so someone has to press "More" to save or flag. A study comparing those rates between phones and desktops should know that.
