# 57. Christof part 5b: scenario tests in the admin app

## Context

Scenario tests (ADR 56) ran only from the command line, with Docker. You asked for a button in the builder, so that people who aren't comfortable with a terminal can test their studies. You also asked for a warning before launching a version whose tests haven't passed, with a setting to turn it off. Your answers are in the vault note `Christof design`, section 11.

## Decision

- **Scenarios are written in the builder, on a Tests page.** It's like the Beats page: `scenarios.yaml` is a page of the draft, checked as it's saved.
- **They run on the server, against a saved version.** A test participant needs a world, and a world needs a version, the same as "Try as a participant." They run by themselves when a version is saved, and **Run tests again** reruns them from the Studies page.
- **They run in the background,** in the API, so saving a version doesn't wait for them. Each run is a row in `scenario_runs` with its status and each scenario's problems. The Studies page checks every 2 seconds while one is running. A run that's been "running" for more than ten minutes is shown as stopped, since the server may have restarted.
- **Test participants are deleted after each scenario,** through the same deletion as a withdrawal. Their worlds run ahead of the real time, so they shouldn't stay where the Monitor page or Christof's card would show them. Only the results are kept.
- **The runner starts test participants directly,** as the "Try as a participant" route does after checking the researcher, instead of signing in as one. So it needs no password on the server, and the command line doesn't need an account either.
- **Launching warns, but doesn't block,** when a version has scenarios that haven't run, are running, or didn't all pass. `studies.warn_untested` turns the warning off for one study, from a checkbox in the warning. "Warn me again" on the Studies page turns it back on. A version with no scenarios gets no warning.
- **No model is used,** so a run costs nothing. Improvised beats use rehearsed or fallback lines.

## Alternatives

- **Testing the draft directly, without a version.** Worlds belong to versions. A hidden test version would use up a version number, or need excluding everywhere versions are listed.
- **A throwaway database on the server.** The API's database login can't create databases, and shouldn't.
- **Keeping test participants, marked as tests.** Their timestamps run ahead of the real time, and they'd fill the Monitor page and Christof's card with runs that never happened to anyone.
- **Blocking a launch until tests pass.** A researcher may know better, such as when a test is wrong. You asked for a warning.

## Consequences

- Migration 0043 adds `scenario_runs` and `studies.warn_untested`.
- Each scenario deleted leaves a row in `data_deletions`, with the reason "scenario test." That's the same record a withdrawal leaves.
- A run uses the API server's time and database. Studies with many long scenarios could slow it while they run. It's fine at today's sizes. A queue would be the next step if not.
