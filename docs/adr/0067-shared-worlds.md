# 67. Shared worlds: participants in one world, who see each other

## Context

Until now, each participant had a world of their own, and everyone else in it was the study's cast (ADR 7). Some studies need real participants to meet: group discussion, norms that spread, people moderating each other. The vault note `Shared worlds design` set out the choices, and Dominic took the default for each:
- **Worlds of a fixed size,** that start when they're full, or after a wait with whoever's there.
- **One condition per world.**
- **Beats:** what a participant sets off is theirs, and timed beats happen once for the world. A beat can say otherwise.
- **Withdrawal:** what they wrote disappears for everyone else, and others' exports note that it's gone.
- **Safety:** the study's automatic rules, plus a researcher removing someone live. Approving each post first was too slow for a conversation.

He also asked for a believable terms of service and privacy policy for the study's site, which goes with this, since a shared site is more like a real one.

## Decision

- **A study turns it on with `worlds: { size, waitMinutes }`.** Without it, everyone has a world of their own, as before. A pilot is always on its own.
- **Joining** (`joinSharedWorld` in `apps/api/src/participants/enter.ts`):
  - takes the oldest world that hasn't started, locked so two people can't both take its last place
  - or starts a new one, drawing its condition the study's usual way, and keeping it on the world (`worlds.condition_id`)
  - everyone after the first gets the world's condition, recorded as an assignment with method `world`
  - a world waiting has its start in the future. When it fills, it starts now. Otherwise it starts when the wait is up.
- **The waiting room.** Until the world starts, `/me/flow` says how many have joined, and the participant app shows "Waiting for others to join". Everything is timed from the world's start, so nobody misses anything.
- **Participants see each other** as they see the cast. They can like, reply, repost, follow, and message each other, and each is told, as the cast's actions tell them.
- **Beats run once for the world, or once for each participant** (`beat_runs.for_actor_id`):
  - a beat set off by a participant is theirs, so each person's first post can get its own reply
  - so is one that does something to the participant, like a message, follow, or warning
  - a timed beat happens once for everyone
  - `per: participant` or `per: world` overrides this
  - decision points aren't allowed in shared worlds yet, since they were written for one person.
- **Moderation is for the whole world,** as on a real site, including a removal answering one participant's flag. Hiding, muting, and blocking stay personal.
- **The export says who was together:** `world_id` in `participants.csv`, `content.csv`, and `beat_runs.csv`. In a shared world, a row's `participant_id` is whoever it's by or for, and empty for what's everyone's.
- **Withdrawal** (`delete_participant_data`, migration 0054):
  - deletes their events, assignment, what they were shown, their notifications, follows, and interactions, and their beats
  - wipes what they wrote, and messages to them, rather than deleting it, and marks it `withdrawn_at`. Others' events point at those rows, so they stay, with nothing in them.
  - Their actor stays, named "Withdrawn", with nothing about them, so others' records still make sense.
  - Feeds leave out what's withdrawn, and anything under it.
  - A world of their own is deleted entirely, as before.
- **The site's terms and privacy policy** are pages a study can add (`site.terms`, `site.privacy`), linked from the bottom of every page. `docs/templates/` has believable ones to start from. They're part of the study's fiction, so the debriefing should say so.

## Alternatives

- **Worlds that are always open,** that people join and leave at any time. That's closer to a real site, but the first and last people would see a near-empty one, and timed posts would land at different points for each. Fixed sizes keep each world comparable.
- **Conditions per participant within a world.** It would allow more designs, but a shared feed differs by condition, so people would see different worlds while thinking they're together.
- **Deleting what a withdrawn participant wrote.** Simpler, but others' replies, likes, and events would point at nothing, and their exports would break. Wiping keeps their records and removes the person.
- **Approving every post first.** Safest, but a conversation where each message waits for a researcher isn't a conversation.
- **Real-time updates now.** Participants see each other's posts when they refresh or move between pages. Live updates, removing someone from the Monitor page, and a load test of 50 participants come in the next pull request.
