# 51. Christof part 1: beats and the director

## Context

Phase 3 of the design plan brings in LLM actors, directed by Christof, from the vault note `Agent runtime design`, as planned in `Christof design`. The study decides _whether_ something happens, the director decides _when_, and a model only ever fills in _what's said_. Part 1 is the director with no model: beats a study writes, and a record of every decision. Dominic chose YAML for beats, since they'll get more complicated, and a tool to help write them can come later.

## Decision

- **Beats are written in `beats.yaml`,** next to a study's sheets. A beat has:
  - an id
  - a trigger (`when`): a time, something the participant does (posts, comments, likes, follows, or reposts, optionally only their nth, on someone in particular, or under what another beat made), or another beat
  - an action (`do`): post, comment, like, repost, or follow, by someone in the cast, on what set it off, what a beat made, or one of the study's posts
  - a delay, fixed or a range
  - conditions
  - `max`, for how many times it can happen
  - `unless`, other beats that stop it

  `docs/guides/writing-beats.md` explains them, and `studies/examples/bystander` is reference study #2.
- **The file is kept as written, among the study's pages,** so it's saved, undone, frozen with a version, and opened into a draft with no new storage. It's read into the definition, checked with the rest of the study, and parsed again by the API, once per version.
- **Nothing runs in the background,** as with reactions and removals. What the participant does writes down the beats it sets off as `pending`, with when each is due, in the same transaction. Loading the feed, notifications, or `/me` calls `catchUp`, which decides each beat that has come due, oldest first, as of when it was due:
  - It skips the beat, with a reason, if a beat in `unless` already happened, or if what it needs is off.
  - Otherwise it does the beat, and writes down any beats that follow it.

  What a beat makes appears at the time it was due, so it's the same however late the next page load is. A delay range is drawn from the world's seed, so it can be worked out again.
- **Every decision is a row in `beat_runs`,** the decision trace. It has what set the beat off, when it was due, whether it fired or was skipped and why, who did it, and what it made. A unique (world, beat, run) and a claim on each pending run mean two page loads at once can't do a beat twice. The rows go with the world on withdrawal, and are in the export as `beat_runs.csv`.
- **Beats act through the same tables scripted reactions use:** content with a `visible_at`, and notifications. So likes count, replies notify, and follows show, with nothing new to read them.
- **The builder has a Beats page:** the YAML, a short reference, and what's wrong with what's saved.

## Alternatives

- **A `beats.csv` sheet.** It's friendlier in a spreadsheet, but beats that depend on each other get awkward in one, and Dominic preferred to plan for complexity.
- **A worker that wakes up when beats are due.** It would be another thing to run and watch. Deciding at the next load gives the same result for what the participant sees, since what a beat makes appears at its due time either way.
- **A table of beats for each version.** The file already freezes with the version as a page, and a second copy could disagree with it.
- **Folding scripted reactions into beats now.** Reactions keep working as they are. A later part can write them as beats, once beats can do everything reactions can, such as removing and warning.

## Consequences

- A beat is decided when something next loads after it's due, which is within 30 seconds while the participant has the page open, since notifications are checked that often. `decided_at` says when.
- Beats can't yet remove, warn, label, or ban. Those are reactions and moderation sheets for now.
- Packs don't carry beats, since packs leave out pages. Beats belong to a study's design, like its consent text.
- The migration adds `beat_runs`, so the API has to stop while it runs.
