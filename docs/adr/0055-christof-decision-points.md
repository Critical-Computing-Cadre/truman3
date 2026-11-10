# 55. Christof part 4: decision points for adaptive designs

## Context

The design plan's "Adaptive interventions" calls for SMART designs and just-in-time adaptive interventions. In these designs, a participant can be re-randomized partway through a study, based on what they've done, and every randomization's probability is kept for analysis. The `assignments` table has had a `decision_point` column for this since the start. Beats (ADR 51) decide what happens within a condition. This decides which condition someone is in. The answers in the vault note `Christof design`, section 9, settled three things:
- the measures come from behavior first, with survey answers later
- re-randomizations are recorded in `assignments`, moving people only forward
- decision points go in `beats.yaml`

## Decision

- **Decision points go under `decide:` in `beats.yaml`,** beside the beats they change. Each has:
  - a `when`, the same as a beat's
  - the `conditions` it's for
  - named `measure`s
  - `groups`, in order
- **Christof reaches them the same way as beats.** A decision point is written down in `beat_runs` when it's set off and decided when it's due, so the timing, the trace, and `when: { beat: ... }` all work the same. It happens once for each participant.
- **Measures are counted from the participant's own events,** as of when the decision was due:
  - **Counts,** by a short name like `post`, or by any event type, optionally `within` a time before the decision
  - **Active minutes,** from heartbeats
  - **Whether a beat fired**

  Survey answers come later.
- **The first group whose tests all pass decides.** Each test gives `atLeast`, `atMost`, or both, inclusive. A group either re-randomizes by weights or says `stay`, and someone in no group stays. There's no expression language, so a rule can't be written wrong in a way the checks can't catch.
- **A re-randomization's draw comes from the world's seed,** the decision, and when it was due, the same way beat delays do. A real participant's world seed is random, so the draw is too, and it can be worked out again from the record. A simulation sets the seed, so its runs repeat.
- **Every decision is a row in `assignments`,** including staying, which has probability 1. The row records the decision point, the method `decision`, the probability, the group, the condition they came from, and the measures. The participant's condition is their latest assignment, as it already was.
- **People only move forward.** A condition reached only by decisions has `weight: 0`, so nobody is assigned it on joining. A decision point may move people to a weight-0 condition, or among the conditions it's for. Moving anyone to a starting condition they weren't in is refused when the study is checked.
- **A move takes effect at once.** It applies to the rest of the page load that made the decision, and from then on. A beat written down for the condition they left is skipped when it comes due, with the reason recorded.
- **The export adds `assignments.csv`,** with every assignment in order, when a study has re-randomized anyone. `beat_runs.csv` now also includes how each line was written (`wording`, `cost_usd`, `writing`), which ADRs 52 to 54 promised but the export had left out.

## Alternatives

- **A separate `adaptive.yaml`.** It would separate decisions from the beats that follow them, and you chose `beats.yaml`.
- **Expressions, like `posts == 0 and minutes > 5`.** They're shorter, but they need a parser, and a mistake shows up only at run time. Structured tests are checked when the study is.
- **Recording only moves, not stays.** SMART analyses need every participant's probability at every stage, including those who weren't re-randomized.
- **Measuring when the decision is made, not when it was due.** Christof decides lazily, at the next page load, so the measures could change depending on when someone next opens the site. Measuring as of the due time is the same either way, like beats.

## Consequences

- Migration 0042 lets a condition's weight be 0.
- The Monitor page still counts people by the condition they started in. Showing where they are now is left for later.
- Survey answers as measures need surveys within the study, which come later.
