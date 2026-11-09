# 56. Christof part 5a: scenario tests, and the API's clock

## Context

Beats and decision points (ADRs 51–55) are logic a researcher writes by hand. A mistake shows up only when a participant meets it. The design plan asks for "scenario tests like 'beat X fires by minute 5 and never in condition B'" and "simulated participants in a fast-forwarded world." This is the first half: scripted participants and the tests. Simulated participants that a model plays come next.

Fast-forwarding needs time to move consistently. The integration tests had been moving a world's start time backward. That doesn't move what was already recorded, and the event log can't be changed, so a participant's earlier actions looked as if they'd just happened. A decision point's "posts within the last 24 hours" would then count the wrong posts.

## Decision

- **The API takes its clock as a setting,** `clock` in its dependencies. The server uses the real time. Every participant route asks the clock, never `new Date()`, and helpers that work out what's visible take the time as an argument, with no default. So the type checker finds anything that would read the real time. A world's start, and a test participant's session, come from the clock too.
- **Scenarios go in `scenarios.yaml`,** kept among the pages and frozen with the version, like `beats.yaml`. Each one has:
  - a name
  - a starting condition
  - steps at set times, each one action or an `expect`

  Everything a scenario names is checked when the study is.
- **The runner goes through the API.** Each scenario starts a test participant through the same admin route a researcher uses. It signs in through the test participant link, acts through the participant routes, and loads `/me` before each step, as a returning participant would. It reads the database only to check what happened and to look up content ids.
- **`pnpm study test <folder>` runs them in a throwaway database,** made for the run and dropped after it, with no model. Improvised beats use rehearsed or fallback lines.
- **Failures say what happened instead,** for example that a beat is set for later, is only in another condition, was skipped and why, or happened at a time it shouldn't have.
- **The example studies' scenarios run in the integration tests,** so a change that breaks an example's logic fails there.

## Alternatives

- **Moving recorded times backward.** The event log is append-only, rightly, so this can't be done consistently.
- **Running the director directly, without the API.** It's faster, but a scenario would then test something other than what participants use.
- **Running scenarios on a real server, as test participants.** Changing the clock there would affect real participants. A throwaway database is safer, and needs no server.
- **Writing scenarios as code.** Researchers write YAML for everything else, and YAML can be checked against the study.

## Consequences

- New participant code must use the clock it's given. A forgotten `new Date()` makes fast-forwarded tests wrong rather than failing loudly, so reviews should watch for it. Admin routes still use the real time where it's about the researcher, such as sessions and exports.
- Running scenarios from the builder, and simulated participants a model plays, are left for part 5b.
