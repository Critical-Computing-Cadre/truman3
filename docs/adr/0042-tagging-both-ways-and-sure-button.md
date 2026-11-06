# 42. Tagging both ways, the "are you sure?" button, and appeals in Forum

## Context

Answers in the vault notes `Photo template design`, section 8, and `Moderation design`, section 16. A study should be able to tag the participant, and if the cast can tag participants, participants should be able to tag the cast. A study should choose which "are you sure?" button nudges people. Appeals should stay for a study about them, and be off otherwise.

## Decision

- **A study tags the participant with `{participant}` in a post's `tagged`.** It's stored as `content.tags_participant`, since a scripted post is shared by every participant's world and can't name one actor. Each participant sees their own name among who's tagged, and the post is on their own Tagged tab.
- **Being tagged is a notification,** "Cleo tagged you in a post," of a new type, `tag`. Its row is written when someone joins, due when the post appears, like any scheduled outcome. Muting or a ban of the poster hides it, as with other notifications from the cast.
- **Participants tag people in the cast** when they post, from a list in the composer (`GET /people`), up to 20. Only the cast can be tagged, not the participant themselves. Who they tagged is `tagged` on `content.created`, and in `content.csv`.
- **`photoTags` goes to version 2,** since what it does changed.
- **`platform.sureButton`** says which button an "are you sure?" box makes dark: `goBack` (the default, as before) or `postAnyway`. It can differ by condition, and is on the builder's Settings page.
- **Appeals are off in Forum unless a study turns them on.** Without answers written, an Appeal button invites something nothing will reply to.

## Alternatives

- **A notification only when a participant opens the post.** It wouldn't reach them, which is the point of being tagged.
- **Scripted reactions from whoever a participant tags.** A study can already write reactions to someone's nth post, from whoever it likes. Reactions that depend on who was tagged can come later, as Dominic said.
- **A per-rule choice of dark button.** One setting for the study, or a condition, is simpler, and a study comparing nudges would compare conditions.

## Consequences

- Changing a template's default only affects versions saved afterward, since a version keeps the features it had. A Forum study already saved keeps appeals on.
- Participants can't search the cast to tag someone. With a long cast, the list gets long.
- A tag of the participant is in `content.csv` as `{participant}`.
