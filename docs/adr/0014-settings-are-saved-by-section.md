# 14. Settings are saved a section at a time

Status: accepted

## Context

Researchers need screens for conditions, platform, feed, and flow. Several people can have a draft
open at once. Posts and comments are saved item by item (ADR 12), with history, undo, and the last
save winning. Settings differ in one way: a section has many fields, so a last save can silently
undo a field someone else just set.

## Decision

Each section of settings, and each page of text, is stored as a draft item of kind `setting`. It
sits on top of what the draft started with. That reuses history, undo, and live updates.

A section is saved with the revision it started from. If someone else has saved since, it's refused
and the person is told, so they can look before saving again.

Renaming a condition saves the new name and every item limited to it as one change, so it's undone
together. Removing a condition that content is limited to is refused.

Sections are saved with a button rather than as you type, because a half-finished list of conditions
isn't worth recording in history.

## Consequences

- Anything that lists a draft's items has to leave out `setting` items. `loadDraft` does this, and
  the routes for posts refuse them.
- Two people can't lose work to each other in the same section, but one of them has to discard and
  redo their edit. Simultaneous editing of the same section is rare, so that's acceptable.
- Forms save less often than the feed does, which could feel inconsistent. Worth watching.
