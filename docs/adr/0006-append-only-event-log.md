# 6. An append-only event log is the source of truth

**Status:** Accepted; implementation starts in Phase 1. Narrowed during Phase 1 planning (see "What goes in `events`").

## Decision

Anything that happens in a world that can't be predicted from the study version is written to an append-only `events` table, tied to its world, condition, and study version. Current state such as feeds and counts may live in other tables for speed, but exports always come from this record.

## What goes in `events`

**Written as events:**

- Everything a participant does, including every action and timing on scripted content: viewing a scripted post, how long it was on screen, liking it, flagging it, commenting on it.
- Scripted reactions to a participant, because they depend on what the participant did.
- Anything an LLM actor or researcher does.

**Not written as events:**

- Scripted content simply becoming available on schedule. The frozen study version plus the world's start time already determines this, so writing it would add about 626 predictable rows per participant in the classic example study.

What a participant was actually shown is recorded in `feed_impressions`. Exports combine `events`, `feed_impressions`, and the frozen version, so analysts get the full timeline without having to join them by hand.

## Why

Research data has to be complete and auditable. Exports, replay, and dashboards can all be built from one record, and new analyses can be run on old sessions. It also leaves room for branching worlds later.

## Alternatives

- **Exporting from current-state tables:** this loses history. It's roughly how older Truman versions export.
- **Full event sourcing, with all state rebuilt from events:** more machinery than we need, and feed reads have to be fast.
- **Writing scripted content as events too:** a simpler rule to state, but it adds a large volume of rows that carry no new information.

## Costs

- State and events have to be written in the same transaction, or they can disagree.
- `events` alone isn't the complete story. Anyone querying the database directly needs to know about `feed_impressions` and the frozen version.
