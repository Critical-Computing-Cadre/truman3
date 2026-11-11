# 63. Reference studies #3 and #4, and what they need

## Context

Reference studies show how Truman 3 is meant to be used, and they're tests of it: #1 is `truman_2023` (EatSnap), and #2 is the bystander study, made up for Christof. In section 14 of the vault note `Christof design`, Dominic chose two of his published Truman experiments for #3 and #4:
- **#3: Bhandari et al. (2021, JCMC) and Ozanne et al. (2022, Big Data & Society).** Who flagged a harassing comment (no one named, other users, or an automated system), crossed with how clear the harassment was, over two days. The measure is whether people flag a later harassing comment nobody moderated.
- **#4: Aghajari et al. (2024, CHI).** How many people in a feed have a "vaccinated" frame on their profile picture (2, 5, or 9 of 30), and what that does to perceived norms.

Section 15 set out what each needed that Truman 3 didn't have, and Dominic took the defaults.

## Decision

- **A label can leave out who gave it.** `by: hidden` in `labels.csv`. A notice from nobody in particular shows only its text and reason. `by: shown` is the default, so labels already written look the same.
- **A label can ask a yes-or-no question,** with `ask`, such as "Do you agree with this flag?"
  - The answer is a `content.label_answered` event, with what the label said and the answer, and it's in the export.
  - It's asked until they answer it, and not of the person whose content it's on.
- **Answering offers the community rules,** if the study has them. The question is fixed: "Would you like to review the community rules?", as in the paper.
- **A study can name a rules page:** `site.rules: pages/rules.md`.
  - Participants can open it from a **Rules** link in the header, and from a label's offer.
  - Opening it is a `rules.opened` event, which says which of the two it was opened from.
  - A flow page can show the same file at the start.
- **Someone in the cast can have a different picture in some conditions,** with a `pictures` column in `actors.csv`, written `medium=ann-framed.jpg|high=ann-framed.jpg`.
  - Every place a participant sees that person's picture uses the one for their condition: feeds, profiles, notifications, stories, and messages.
  - It's written the way per-space flair already is.
- **Scenario tests can flag,** with `flag:`, on a post, a comment (`{ comment: id }`, new), or what a beat made. `sees` also matches a label's text and reason. #3's main measure is flagging the comment nobody moderated, and its notices differ by condition, so its tests need both.
- **Each study is its own small folder,** `studies/examples/flag-source` and `studies/examples/vaccine-frames`. Each uses a few of #1's images, not all of them, and comes with scenario tests for its conditions.

## Alternatives

- **A `pictures.csv` sheet,** which section 15 suggested. A column on the actor is written the way flair is, and it stays with the person in the builder and in packs without a new kind of item.
- **Drawing frames in code.** The paper's frames were images, and any badge or frame another lab wants is an image too. A per-condition picture covers all of them.
- **Notices longer than 40 characters as labels.** A short label with a longer reason under it fits every layout's label bar, and labels already had reasons.
- **The rules question in the study's own words.** Only one study needs it yet. It can become a setting when a second one does.

## Consequences

- Migration 0049 adds `scripted_labels.shows_who` and `scripted_labels.ask`.
- The builder doesn't yet edit a label's `by` or `ask`, or an actor's per-condition pictures. They come from sheets, and are kept when a draft is saved.
- #4's frames are colored borders standing in for the real artwork, which a lab would swap in.
- A label's line reads "Labeled by …", not "Flagged by …". #3 says who flagged it in each notice's reason, so it reads naturally either way.
- Scenario tests check text, so they can't check which picture someone has. An integration test checks that instead.
- An "updated their profile picture" post needs its own copy of the framed image in `media/posts`. A post can't yet show its author's picture for the condition.
