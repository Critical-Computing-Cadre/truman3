# 5. Studies are data, not forks

**Status:** Accepted; implementation starts in Phase 1

## Decision

A study is a folder holding `study.yaml`, CSVs, and media, validated against a schema in `packages/core`. Launching a study freezes a version, and all data is tied to the version a participant saw. An importer reads the older Truman CSV format.

## Why

In older versions, each study became its own fork of the code, and features added in one fork didn't reach the others. If a study needs something new, it should become a platform feature that other studies can turn on.

Plain files also mean researchers can work in the admin builder, a text editor, or through an agent, and all three edit the same thing.

## Alternatives

- **Database records only:** harder to review, diff, or share as part of a replication package.
- **Code plugins per study:** this would bring back the forking problem in a smaller form.
