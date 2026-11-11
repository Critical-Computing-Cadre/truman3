# 62. Beats that moderate, packs that carry beats, and where people are now

## Context

Three loose ends from Christof (ADRs 51 and 55), listed in section 13 of the vault note `Christof design`, which Dominic chose to finish before Phase 4:
- **Beats couldn't moderate.** Moderation could only be written ahead of time in sheets, at set times or in answer to flags, reports, and automatic rules. A study couldn't say "a moderator removes their reply to Jake five minutes later, in this condition."
- **Packs left out beats** (ADR 51). A pack copied another study's posts and people, but not what the cast does.
- **The Monitor page counted people by the condition they started in,** so a study with decision points couldn't see where people are now.

## Decision

- **Four moderation actions for beats:** `remove`, `label`, `warn`, and `ban`.
  - Each needs its feature (`removal`, `labels`, `warnings`, `bans`) in the condition, as other beat actions do.
  - A warning is only about what the participant wrote, so it acts on what set it off: their post or comment. A study can't be saved otherwise.
  - A ban names someone in the cast by username, and is from everywhere.
- **They write the same records as other moderation.** Each is a row in `notifications`, as answers to flags and automatic rules are, so feeds, the mod log, appeals, and the export treat it the same. It goes to whoever wrote what it's about. So the participant is told about their own posts and comments, and not about someone else's.
- **Packs carry `beats.yaml`, `scenarios.yaml`, and `personas.yaml`,** as written. The tests and personas go with the beats they test.
  - Starting from "just the background" leaves all three out. Beats name the pack's conditions, and that choice leaves those conditions behind.
  - Consent text and the flow still don't travel (ADR 15).
- **The Monitor page counts people where they are now,** from each person's latest assignment, beside where they started. The column only shows once a decision point has moved someone, so other studies' pages don't change.

## Alternatives

- **Moderation beats as a separate kind of record.** Notifications already hold world moderation, and everything that shows or counts moderation reads them.
- **Warnings about anything.** A warning tells the participant about what they did. Warning them about Jake's comment would read as a mistake.
- **Packs carrying only beats.** Scenario tests and personas check and pilot the beats, so they're most useful together.

## Consequences

- No database change.
- Scripted reactions (`reactions.csv`) could now all be written as beats, as ADR 51 planned. They stay as they are, since studies use them.
- Packs saved before this don't have beats, and start studies without them, as before.
