# 18. Platforms are built from features

**Status:** Accepted

## Decision

A **feature** is one thing a platform can do, like likes or comments. A **template** is a named set of features with a layout. A researcher starts from a template, then turns features on or off for the study or for a condition. They can mix these however they like, including into platforms that don't exist.

What's on in a condition is worked out in one order: the template, then the study, then the condition (`featuresFor` in `packages/core/src/study/platform.ts`).

- **Features are code.** There's no way to add one while the platform runs, or to paste in code from the builder. A lab adds one with a pull request or its own fork.
- **The server enforces them.** When a feature is off in someone's condition, its API routes refuse. Hiding a button is never the only control.
- **Freezing copies the template in.** A version stores its layout and every feature's value. Changing a template later can't change a launched study.
- **Layouts only arrange.** A layout decides where things go. Whether something appears, and what it does, belongs to its feature's component.
- **A layout's look doesn't change once it's used.** To change one, add a new name, such as `classic-2`. Features have version numbers, which the codebook reports.
- **Events keep their names** whatever a button says, so analysis code keeps working.

## Why

Dominic's answers (2026-11-02, in the vault note "Platform types design"): templates should be about what different platforms let people do, not how they look. They should work like React components: building blocks teams can mix and match. New teams can use the template closest to what they study, and others can build platforms that don't exist.

Classic was rebuilt this way first, with no visible change. If the model didn't fit the platform we already have, it wouldn't fit Reddit.

## Consequences

- A feature touches a few places, listed in `docs/guides/adding-a-feature.md`. They aren't one folder, because `core` can't depend on React, and API routes need the database.
- Content written for a feature that's off in a condition doesn't show there. Validation warns about it.
- The foundation isn't done. Threads, reactions with types, attachments, spaces, and several feeds are still to come, and they're what the next templates need.
