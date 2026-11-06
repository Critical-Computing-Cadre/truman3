# 46. Labels on posts

## Context

From the vault note `Template looks`, section 5: Bluesky's labels, such as "Spam", on a post. Dominic said yes, and that a study chooses whether to use them. He didn't answer whether a label hides a post or sits above it, or whether it can be appealed, so section 6 of that note records the choices below for him to change.

## Decision

- **A feature, `labels`, on only in Short posts.** Like removal (ADR 31), it does nothing until a study writes labels, so it can be on there without changing anything.
- **Written the way removals are.** `labels.csv` labels what the study wrote, at a set time, with who gave it, the label, an optional reason, and `hides`. A new reaction type, `label`, labels a participant's nth post or comment, with the label as its body. Both are in the builder's Moderation page.
- **The study chooses, for each label, whether it hides.** One that hides covers the post or comment with the label, who gave it, and Show. Pressing Show is `content.label_shown`, with the label, because whether people look is likely what a study measures. One that doesn't hide is a line above, which stays after Show, with a way to cover it again.
- **A participant's own post is never covered for them,** as on Bluesky, so a reaction's label never hides. They're told in notifications.
- **Unlike a removal, everything is still sent.** A covered post's text reaches the browser, so Show needs nothing more. A label is a warning, not a removal, and a study wanting what's covered kept out of responses can remove it instead.
- **Appeals work as they do for removals.** On a platform with appeals, the author of a labeled post can appeal once. `moderation.appealed` now says whether it was of a removal or a label. A `restore` answer takes the labels off as well as putting back what was removed. The notification says which.
- **Worked out each time, as removals are.** `loadLabels` in `apps/api/src/feed/build.ts` is the one place that says what's labeled for a person by now. A removal takes the place of labels on the same thing.
- **Recorded in impressions and exports.** `impressions.csv` gets `labels` and `labeled_comment_ids`, since a label comes and goes with time and condition. An export has `labels.csv`.

## Alternatives

- **Always hiding, or never.** Bluesky does both, depending on the label, so a study should be able to as well.
- **A label from a fixed list,** such as Spam, Misleading, or Rude. A study may want its own wording, so it's free text up to 40 characters.
- **Withholding a covered post's text until Show.** It would need a second request for every Show, and a label isn't meant to keep anything from anyone who chooses to look.
- **Not recording Show.** It's the one thing a participant does with a label.

## Consequences

- The migration adds `scripted_labels`, and "label" to the reaction, notification, and draft item types, so the API has to stop while it runs.
- A participant can't label anything, and labels have no list of their own like the mod log. Either can come later.
- A study with labels on both a post and its comments has a cover for each.
