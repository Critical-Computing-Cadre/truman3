# 103. A community of each participant's own

## Context

ADR 102 writes one live community for a condition. Dominic asked for the other live option too, "C" in the design note, and for the cast to be able to react to what participants post, as something a research team chooses. His answers: after the per-condition one, with a cap on what one participant can cost, and shared worlds later.

It gives up the thing the other two keep: two people in a condition no longer see the same posts.

## Decision

- **One more setting on a live community: `own`,** with `capUsd`, the most one participant's can cost, 50 cents unless a study says.
- **Up to their first day it's their condition's community,** written at launch as in ADR 102. Nothing can be written for someone who hasn't arrived, and this way nobody arrives to an empty site while a model writes.
- **From their second day, each day is written for them, when they first come back that day.** Not a day ahead: written as late as it can be, it takes in what they posted the day before. The day's posts are timed through the day, so the ones before now show as earlier today, and the rest come as the day goes on.
- **The model is told what they've posted,** their last ten posts, and may answer the ones nobody has answered yet. An answer is a reply under their own post, by someone in the cast, and they get the usual notification. A post is offered for answering once.
- **This is how the cast reacts without a beat.** A study chooses it by turning `own` on. A reply that has to come at once, or at a set point, is still a beat (ADR 52).
- **Same table, same code.** A participant's days are rows in `community_days` with `world_id` set, and `condition` holding `world:` and the world's ID, since that column is what says which community a day belongs to. They go with the world if the participant withdraws. Answers are kept beside what was written.
- **Checked and held the same way.** Every line, answers included, goes through the check. `hold` holds each participant's days too.
- **The cap is counted from the participant's own days.** At the cap theirs goes quiet. The study's budget and pause switch still apply over everything.
- **The Monitor page** says how many participants have one and what it's cost, and lists the days held and the latest thirty.

## Alternatives considered

- **Their own from the moment they arrive.** It would mean writing days of history for every participant at the door, at the cost of a drafted community each, with nothing about them to take in yet.
- **A day ahead, like the shared one.** A researcher could look at it first. In practice nobody reads three hundred participants' tomorrows, and it would always be a day behind what they said.
- **Answering at once, as they post.** That's what an improvised beat does, with a trigger a study can test. Doing it here too would make two ways to do one thing.
- **A separate switch for answering.** A community of someone's own that ignores what they say has little use, so one switch covers both.
- **A table of its own for participants' days.** It would be the same columns again, and the same code twice.

## Consequences

- **Between-participant variation inside a condition.** The builder says so where it's turned on. Every post is in the export, for each participant, with `live-own-…` references.
- **What participants post is sent to the model,** as with live writing.
- **Cost grows with participants and days.** It hasn't been measured with a real model yet. The cap bounds each participant, and the study's budget bounds all.
- **A participant who skips a day** has it written when they return, so the story carries on, and that day is paid for unseen.
- **Answers can't be taken out one at a time** on the Monitor page yet. Posts can.
- **`condition` in `community_days` isn't always a condition.** The schema says so.
