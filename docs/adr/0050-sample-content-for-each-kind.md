# 50. Sample content for each kind of platform

## Context

Dominic found it slow to build a study from nothing every time he wanted to try a kind of platform or see a change. Packs (ADR 15) can hold content, but they're added from the command line, and staging had none.

## Decision

- **A starter for each kind of platform, in the repo,** at `studies/starters/<template>/`. Each is an ordinary study folder: made-up people, posts, comments, and responses, and what that kind has, such as communities, flair, polls, and moderation in Forum, reposts, labels, and context notes in Short posts, and stories, places, and tags in Photo. A few posts arrive after someone joins, so the timeline shows new ones.
- **"Sample content for …" on the New Study page,** for whichever kind is chosen. It starts the study the way a pack does, so it's copied in and can be changed. Its items are marked as coming from `starter:<template>`.
- **The API reads the folder when it's needed,** and stores its pictures like any other, once per server. Nothing has to be added to a server first, so staging and any lab's copy have them as soon as they run this version. The container includes the folders.
- **The pictures are drawn by a script,** `scripts/starter-pictures.ts`: hills, meals, a city, a beach. They're small, have no licence to track, and can be redrawn.
- **A test starts a study from each one** and checks the draft has nothing to fix, so a change to the study format can't quietly break them.

## Alternatives

- **Saving each starter as a pack when the server starts.** It needs a database write at startup, and a pack can't be told apart from one a lab saved.
- **Stock photos.** They look more real, but each needs a licence, and they make the repo much bigger.
- **Generating content with a model.** That's part of the agent work (phase 3), and a starter should be the same every time.

## Consequences

- A new feature worth trying out should get a row or two in the starter for its kind.
- Starters are for trying things out. A real study should still be built for its question, and its consent text replaced.
