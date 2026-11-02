# 15. Content packs are copied, and leave out consent

**Status:** Accepted

## Decision

A pack holds a cast, posts, comments, reactions, conditions, and the settings their pacing depends on. Starting a study copies all of it into the study's draft. A pack never changes after it's saved, and a study never points back at one, except to record where its items came from.

A pack leaves out consent text and the study's flow. A new study starts with a placeholder telling the researcher to use their approved consent text.

Starting from a pack offers a choice: all of it, or just the background, which leaves out what's limited to a condition, and anything that depended on it.

Packs added from the command line are for every team on the server. Packs saved in the app are for the team that saved them.

## Why

Researchers want to control their content, since the background could affect results. A copy lets them change anything, and a later change to a pack can't reach a running study.

Consent text belongs to one study and its IRB approval. Carrying it along could put another lab's approved wording in front of participants without anyone choosing that.

## Consequences

- A pack saved from a study that came from a pack records the earlier source under `before`, so generated content stays marked as it passes through packs.
- Improving a pack doesn't improve studies already started from it. That's deliberate.
- Packs can't be deleted or renamed yet.
