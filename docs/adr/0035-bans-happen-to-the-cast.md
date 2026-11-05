# 35. Bans happen to the cast, and answering reports

## Context

The design note first imagined banning a participant. Dominic said a participant isn't banned, at least with one real person in a study. They might see someone in the cast get banned, who then can no longer post in the simulation. Answering a report of a person was left out of ADR 34, since a notification had to point at a post or comment.

## Decision

- **Two features, `bans` and `reportAnswers`, off in Classic and on in Forum.** Each does nothing until a study writes some.
- **A ban names someone in the cast, a moderator, a time, any reason, and optionally one space.** It's written in `bans.csv` or on the Moderation page. Nothing can ban a participant.
- **What they wrote before stays, and what comes after doesn't appear.** That includes anything under it, since a reply can't show without what it replies to, and it can't be reached by its address either. A study that also wants their earlier posts gone writes removals.
- **Their scripted reactions stop too.** One that would come due after a ban isn't scheduled, and isn't recorded as about to happen. One already scheduled when a report leads to a ban doesn't show.
- **Others can tell.** They get a "Banned" tag where it applies, a note on their profile, and a line in the mod log.
- **A report's answer sends a message or bans them,** and can name someone or be for any report. One naming them wins, as in ADR 34. A ban from a report only applies in that person's world, so each participant's report only affects what they see.
- **A notification can now be about a person.** `target_content_id` can be empty, `target_actor_id` says who, and a check makes sure there's one or the other.
- **`hiddenByBan` in `apps/api/src/feed/build.ts` is the one place that decides what a ban hides,** used by the feed, the preview, and what can be acted on.

## Alternatives

- **Banning a participant,** with a notice and closed post boxes. Dominic ruled this out for now. It might come back once several real people share a world.
- **Hiding everything a banned person wrote.** Past posts staying is what a bystander would see on most platforms, and a study can remove them if it wants to.
- **Recording each thing a ban hid.** It'd be a second record of what the ban and the time already say. As with anything not shown, it just isn't in `impressions.csv`, and the codebook says so.
- **A separate table for answers about people in notifications.** They're due at a time, tell a participant, and go with the world on withdrawal, which is what `notifications` does.

## Consequences

- The feed being edited still shows what comes after a ban, so it can be edited. Validation warns about it, and a saved version's preview hides it.
- Scripted votes already scheduled from someone later banned still count toward a participant's karma, though they don't show on the post. This is small, and easy to fix if a study needs it.
- Someone's own moderator decisions carry on if they're banned, since being banned stops what they post, not their role in the study. A study can avoid writing that.
- Reporting someone a second time doesn't answer again. Blocking and following them are unaffected.
