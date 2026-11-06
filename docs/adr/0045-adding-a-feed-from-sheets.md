# 45. Adding a feed from sheets

## Context

From the vault note `Better builder design`, part 2. Writing a feed one post at a time in the builder is slow when a study has hundreds of posts, and many researchers already keep theirs in a spreadsheet. Dominic answered three questions: an upload adds to a draft rather than replacing it, pictures come in a zip with the sheets, and it starts with most of a feed (people, posts, and comments), with the other sheets later.

## Decision

- **"Add from sheets" on a draft.** It offers a zip to download with `actors.csv`, `posts.csv`, and `comments.csv`, an example row in each, a text file on how to fill them in, and empty `media/actors/` and `media/posts/` folders for pictures. The researcher fills them in anywhere and uploads the zip.
- **The columns follow the platform.** A sheet only has columns for what the study has on in some condition, and for its layout, so a Photo study's posts sheet has `place` and `tagged` but no `title`. An upload still takes every column a study folder can have. The list is in `packages/study-files/src/sheets.ts`.
- **The same reader as study folders.** `loadStudyFolder` is split so its sheet reading, `readStudyTables`, takes files from anywhere: a folder, or a zip in memory. Rows, columns, and messages are the same as for `pnpm study validate`.
- **Adding, never changing.** A username or ID already in the draft is refused, with its sheet and row, rather than taken as a change. Everything else is checked together with what the draft has, the way a study folder is checked, so a post can be by someone already in the cast. Only problems in the sheets are reported.
- **All or nothing.** If anything has a problem, nothing is added, and every problem is listed with its sheet and row. If it's fine, it's added in one transaction as one change, which Recent changes can undo. Items are marked as from a file.
- **Pictures are stored like any other.** Each is checked to be a JPEG, PNG, GIF, or WebP under 10 MB and stored under a hash of its contents. If everything in the zip is in one folder, that folder is left off, and files a Mac adds are ignored. A zip can't be more than 200 MB, packed or unpacked.
- `startStudy` and the upload share how a file's people, posts, and comments become items, in `packages/drafts/src/from-files.ts`.

## Alternatives

- **Replacing the draft with the upload.** It would lose anything edited in the builder.
- **Taking a repeated username or ID as an update.** It's more powerful, but a typo could quietly change the wrong post, and the builder is already the place to change things.
- **Uploading the sheets, then each picture.** A zip is how a study folder already holds pictures, and it's one step.
- **Every sheet at once.** Reactions, stories, moderation, and spaces come next. People, posts, and comments are most of a feed.

## Consequences

- A study whose media is hosted elsewhere (`media.baseUrl`) still takes uploaded pictures from the zip.
- Recent changes now counts every item in a change, so an upload says "added ... and 299 more".
- Adding a column to `posts.csv` and the others means adding it to `sheets.ts` too, if researchers should see it in the download. A unit test checks the download only has columns a folder can have.
