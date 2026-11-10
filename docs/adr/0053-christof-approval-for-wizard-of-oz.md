# 53. Christof part 3a: beats a researcher approves

## Context

The vault note `Agent runtime design` planned an approval mode for Wizard of Oz studies: an agent drafts a line, a researcher approves or changes it, and then it's posted. It also helps when trying out a new persona. This is the first half of Christof part 3. Rehearsed lines are the second half.

## Decision

- **`approval: all` in `live`, or `approve` on one beat,** makes beats wait for a researcher. It works with live writing off too, so a researcher can write every line in a pure Wizard of Oz study.
- **A waiting beat is `awaiting` in `beat_runs`,** after it's due and decided as possible. Its suggested line is in `writing.draft`: the model's line if live writing is on, or else the fallback or fixed text. Nothing is posted yet.
- **The Monitor page lists what's waiting:** the beat, its note, who acts, what it's on, a box with the line to change, and Approve or Skip. It checks every 5 seconds while anything waits.
- **An approved line appears when it's approved,** not when it was due, since that's when the participant could first see it. Beats after it count from then. Who decided, the suggested line, and whether it was changed are recorded.
- **Nobody waits forever.** If no researcher decides within `approvalTimeout` (ten minutes by default), the fallback or fixed line is used, as of when the time ran out. A study can say `never`. If the draft was a rehearsed line, it's used instead, since a researcher read it when they saved the version (ADR 54).
- **A researcher's own words aren't checked by the model.** They're the researcher's responsibility, and they're recorded as theirs.
- **Each beat is decided once.** Deciding claims the beat, so two researchers, or a researcher and a timeout, can't both act on it. The second gets "Someone else decided it."
- **Who decided is recorded by name,** not email, since the records are part of the study's data.

## Alternatives

- **Posting an approved line at the time it was due.** It would appear in the past, under posts the participant has already read.
- **Waiting forever by default.** A researcher stepping away would leave participants with a feed where nothing happens.
- **A separate screen for approvals.** The Monitor page is already where researchers watch a running study.

## Consequences

- An approved beat's `due_at` stays when it was due, and what it made appears at the approval. The gap between the two is how long it waited.
- A study using approval needs someone watching the Monitor page while participants take part. With `never`, it needs that throughout.
- Migration 0041 adds `awaiting` to the statuses a beat run can have.
