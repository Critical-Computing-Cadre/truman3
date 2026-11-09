# 58. Archiving and deleting studies

## Context

The Studies page fills up with studies made to try something, and there was no way to remove one. But a study can hold research data: what real participants did, records of withdrawals, and Prolific payments. Those have to be kept. The database protects them on purpose: frozen versions can't change, and the event log and assignments are append-only (ADR 6).

## Decision

- **Archiving hides a study** from the Studies page. Any researcher who can edit it can archive it, and restore it from **Archived** at the top of the page. It's `studies.archived_at`. Nothing is deleted, and its monitor and downloads still work. A study open to participants has to be stopped first.
- **Deleting for good** is for an archived study that only test participants took part in. It removes the study, its versions, drafts, test participants, test runs, launch and download records, and test participants' uploads.
- **These keep a study from being deleted**, and it can stay archived:
  - real participants
  - withdrawals on record
  - Prolific payments

  Scenario-test deletions don't count as withdrawals.
- **Only a team's owners can delete,** and they type the study's address to confirm.
- **The database does the deleting,** in `delete_study`, a function that runs with the tables' owner's rights, like withdrawal does. It checks the same rules again, so it refuses a study with real participants even if called directly.
- **The protections let a deletion through** only when that function has turned it on and is running as the tables' owner. So the API's login can't turn it on for itself.
- **Each deletion is recorded** in `study_deletions`: the study's id, address, title, who deleted it, and when.

## Alternatives

- **Only archiving.** It tidies the list, but test studies would pile up in the database forever.
- **Deleting any study, after a warning.** A study with real participants holds data that ethics boards and journals may ask for, and a withdrawal record proves a deletion was done. A button shouldn't be able to remove those.
- **A setting that turns the protections off for the API's login.** It would weaken every other rule that keeps data from being changed.

## Consequences

- Migration 0044 adds `studies.archived_at` and `study_deletions`. Migration 0045 adds `delete_study`, and lets the protection rules allow it.
- Study images stored by their content can be shared with other studies, so they stay in storage.
- A new table that refers to a study or its versions has to be added to `delete_study`, or deleting a study will fail with a foreign key error. The integration test in `archive.itest.ts` would show it.
