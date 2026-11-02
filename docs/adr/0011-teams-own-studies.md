# 11. Teams own studies

**Status:** Accepted

## Decision

Every study belongs to a team, and researchers reach a study through their team, with a role of owner, editor, or viewer. Each lab runs its own copy of Truman 3 for now, with one team. Accounts are created from the command line, with no public sign-up, and email isn't required to work.

## Why

A lab could later run a hosted version that other researchers use, the way WordPress can be self-hosted or hosted for you. Putting teams in the data model now means that wouldn't need a rewrite. Every admin route checks access through the team, so one server could hold many labs.

## Alternatives

- **No teams until hosting exists:** simpler today, but adding access checks to every route later is a large, risky change.
- **Build sign-up and billing now:** there's no one to serve yet. Going public needs a website, documentation, and test instances first.

## Costs

The first version has a concept it doesn't strictly need. Passwords are reset from the command line, since there's no email to send a reset link.
