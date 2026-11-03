# 22. Votes are a feature beside likes

## Context

The Forum template needs up and down votes. The plan was "reactions with a type," which could mean replacing likes with one general system. Likes and votes behave differently, though: a like is on or off, while a vote is one of two choices that replace each other, and it's shown as a score.

## Decision

`votes` is its own feature, off in Classic, with its own route and event, `content.voted`. Likes stay as they are.

- **One vote per person, per item.** A new vote replaces the old one, and null takes it back. The event records each change, and `content_interactions` holds the current state.
- **Written counts are two columns,** `base_ups` and `base_downs`, set with `ups` and `downs` in the spreadsheets and in the builder. They're explicit numbers. There's no setting to draw them at random, as likes have, until a study needs one.
- **The score isn't stored.** A browser gets ups and downs and shows the difference, and a layout could show them apart.
- **Scripted actors can vote** on a participant's nth post or comment, with reaction types `up` and `down`. So a study can give someone negative feedback on their own post.
- **Scripted votes don't notify anyone.** Platforms with votes generally don't say who voted, so these change only the score. They use the `notifications` table, since that's how scripted reactions come due, and the notification list and count leave them out.

## Alternatives

- **One general `reactions` system now, with likes moved into it.** It would change the study format, every spreadsheet, and analysis of `content.liked`, to support reaction types no study has asked for yet. Facebook-style reactions can follow this pattern as another feature when Community needs them, and that's the point to ask whether to merge them.
- **A JSON column of counts by type.** It handles new types without a migration, but nothing would check what's in it.
- **Notifying people of votes.** A study might want this as a manipulation. It would be a setting added later.

## Consequences

Each new kind of reaction adds columns and a route. Ranking by score, which Forum's "top" order needs, isn't included: rankers don't see counts yet.
