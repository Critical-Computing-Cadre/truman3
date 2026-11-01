# 6. An append-only event log is the source of truth

**Status:** Accepted; implementation starts in Phase 1

## Decision

Every action by every actor, whether participant, script, or agent, is written to an append-only `events` table, tied to its world, condition, and study version. Current state such as feeds and counts may live in other tables for speed, but exports always come from events.

## Why

Research data has to be complete and auditable. Exports, replay, and dashboards can all be built from one record, and new analyses can be run on old sessions. It also leaves room for branching worlds later.

## Alternatives

- **Exporting from current-state tables:** this loses history. It's roughly how older Truman versions export.
- **Full event sourcing, with all state rebuilt from events:** more machinery than we need, and feed reads have to be fast.

## Costs

State and events have to be written in the same transaction, or they can disagree.
