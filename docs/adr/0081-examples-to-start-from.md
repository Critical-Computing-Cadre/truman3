# 81. Starting a study from an example

## Context

The site tells researchers to take one of the example studies and change it. On a lab's own Truman that's `pnpm study import`. On a hosted Truman a lab has no command line, so the only way was to rebuild an example by hand from its page.

Truman already has packs (ADR 15): a study's content that a new study can start from, either one lab's or everyone's. A pack for everyone was made with `pnpm study add-pack`, which a hosted Truman's operator can't run against the cloud for the same reason as in ADR 78.

## Decision

- **With `DEMO_STUDIES=true`, the server offers each of the five examples as a pack for everyone,** named "Example: Bystander" and so on, with a line on what it is. It does this as it starts, after the demos.
- **Town talk is included,** though it has no demo. Copying it puts nobody in a room together.
- **When an example changes, its pack is replaced.** A study started from a pack is a copy, so studies already started keep what they got. Only packs for everyone that no researcher made are replaced, so a lab's own pack with the same name is safe.
- **It brings what any pack brings:** the cast, posts, comments, pictures, conditions, platform settings, beats, and tests. Not the consent page or the rest of the flow, which stay the lab's own to write.
- **A lab's study from an example has its own address,** which the lab chooses, so it can't collide with the demo at `try-<slug>`.

## Alternatives considered

- **A "copy into my lab" button on each example's page on the public site.** The site is static and doesn't know who's signed in. The New study page does, and is where a researcher chooses what to start from.
- **A separate setting from the demos.** Both are "this server has the examples", and a host that wants one will want the other. One fewer thing to set.
- **Copying the consent page too.** The examples' consent pages are placeholders. A study that launched with one would be a mistake nobody intended.

## Consequences

- A lab's own Truman gets the examples in New study by setting `DEMO_STUDIES=true`, and gets the public demos with them. `pnpm study add-pack` still works for one without the other.
- The list on New study is five longer for every lab on a hosted Truman.
