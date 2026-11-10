# 59. Christof part 5b: simulated participants, at random

## Context

Scenario tests (ADRs 56 and 57) check paths a researcher writes down. They can't find the paths nobody thought of: a beat that never happens, or happens in a condition it isn't in. Section 11 of the vault note `Christof design` listed three uses for simulated participants. You chose (a) piloting, with a model playing a persona, and (b) stress-testing with many random participants. You also asked for (c) synthetic data as an option for other labs.

This ADR covers (b), and the runner that (a) and (c) will use too.

## Decision

- **A simulated participant is a test participant, driven the way a scenario's is.** The scenario runner's setup (the API on a clock it moves, starting a test participant, sending requests as them) moved into `apps/api/src/scenarios/harness.ts`, which both runners use.
- **A behavior decides what they do.** Each time they look at their feed, it's given what they see and returns one action or nothing. This PR has the random behavior. A model playing a persona will be another behavior, with the same runner and report.
- **The random behavior is seeded.** A run has a seed, and participant `n` uses `seed + n`, so the same seed repeats a run exactly. Their world's seed comes from the run's seed too, so delays, rehearsed lines, and re-randomizations repeat as well. The report gives the seed, and the admin app has "Repeat the last run."
- **What they do:**
  - Each one is quiet, average, or busy.
  - They visit at the start, for 5 to 25 minutes, and on a study of a day or more, up to three more times a day.
  - Within a visit they look every 20 seconds to 3 minutes.
  - At each look they may like, comment, reply, repost, follow, post, or flag, on what they see, favoring what's near the top.
  - On platforms that show comments only on a post's page, they sometimes open a post.
- **Conditions are spread evenly,** in turn, among the conditions people can be assigned to. Conditions only a decision point sends people to (weight 0) aren't started in.
- **The report** says how many started in each condition and what they did. Something the study refused, like reposting where reposts are off, is counted as refused, not as a problem. For each beat it gives how many it happened for in each condition, the most times for one participant, why it was skipped and how often, and how often it was still due when they finished. For each decision point, it gives where people were sent. "Worth a look" lists:
  - beats that never happened for anyone who could have had them
  - beats that happened in a condition they aren't in
  - decision points never reached
  - errors from the API
- **On the server, it runs in the background from a Simulate page,** for a saved version, like scenario tests. Each run is a row in `simulation_runs` with its settings and report, and the participants are deleted afterwards. One run at a time per version, up to 200 participants. A run "running" for more than 30 minutes is shown as stopped.
- **From the command line,** `pnpm study simulate <folder> [participants] [--seed N]` does the same in a throwaway database.
- **No model is used,** so a run costs nothing. Improvised beats use rehearsed or fallback lines.
- **`simulation_runs` rows are deleted with their version** (`ON DELETE CASCADE`). Deleting a study (ADR 58) then needs no change to `delete_study`, and the runs are only a report on test participants who no longer exist.

## Alternatives

- **Trying every path.** A study's paths multiply with every beat a participant can set off, and timing matters too. Random sampling with a seed finds the common problems cheaply, and repeats any run.
- **Running participants at once instead of one after another.** The harness has one clock for the API it makes, so participants would need one harness each. It's fast enough today: 100 participants in the bystander study take about 40 seconds on a laptop.
- **Keeping the participants, for synthetic data.** That's part (c). It needs them kept apart from real data in exports and in deleting a study, so it's its own change.
- **Counting by the condition they ended in.** A decision point can move people. The report counts by the condition they started in, which is what a researcher assigned, and the decision points section shows where people went.

## Consequences

- Migration 0046 adds `simulation_runs`.
- Each simulated participant deleted leaves a row in `data_deletions`, with the reason "scenario test," the same as a scenario's.
- Like scenario tests, a run uses the API server's time and database. 200 participants on staging's small server could take several minutes and slow it while they run.
