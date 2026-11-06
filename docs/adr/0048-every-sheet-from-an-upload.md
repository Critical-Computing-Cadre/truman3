# 48. Every sheet from an upload

## Context

ADR 45 let a draft take people, posts, and comments from a zip of sheets. Dominic said to start there and add the rest later. This adds the rest.

## Decision

- **An upload takes every sheet a study folder can have:** `spaces.csv`, `reactions.csv`, `stories.csv`, `context-notes.csv`, and the moderation sheets (removals, labels, answers to flags, reports, and appeals, bans, and automatic rules).
- **The download has a sheet for each thing the study has on.** Forum gets `spaces.csv` and the moderation sheets, Photo gets `stories.csv`, Short posts gets labels and context notes. Every study gets `reactions.csv`. The note with them lists each sheet and what it's for.
- **The example rows make a small study with nothing to fix.** A unit test reads every template's download with everything on, and checks it the way a study folder is checked. A second person, "mods", gives the moderation examples someone to act.
- **Names that must be unique are refused if the draft has them:** usernames, space keys, and the IDs of posts, comments, stories, context notes, and rules. Rows without a name, such as a reaction or a ban, are only ever added.
- **Packs and uploads make draft items the same way,** through `itemsFromTables` in `packages/drafts/src/from-files.ts`. `startStudy` used to do it inline.
- **What was added is counted by kind,** and the dialog says it in words, such as "2 people, 1 community, and 3 removals".

## Alternatives

- **Only the sheets the builder has screens for.** An upload is for a lab that already works in spreadsheets, and they have all of these.
- **A separate upload for each sheet.** One zip, checked as a whole, means a removal can point at a post in the same upload.

## Consequences

- A new sheet in study folders needs a line in `UPLOAD_SHEETS` and `SHEETS` in `packages/study-files/src/sheets.ts`, with its example rows. The unit test fails until the examples check out.
