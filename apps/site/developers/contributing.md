---

title: Contributing
description: How the Truman project works, the tests to run, the code rules, and how to add a feature.
---

# Contributing

Thanks for thinking about contributing. Truman is built to be followed and extended by people who weren't there when it was written, including students who join a lab later. The habits on this page exist for them, and they're what we'll look for in a pull request.

## How the project works

- **Small pull requests.** Each one has a plain-language summary of what changed and why. It says how it was tested, including anything that wasn't.
- **Record decisions.** A choice someone might later question gets a short ADR in [docs/adr/](https://github.com/Critical-Computing-Cadre/truman3/tree/main/docs/adr), with the alternatives that were considered.
- **Tests show intended behavior.** New behavior comes with tests. When a test can't cover something, such as a database connection, run the real thing as well.
- **Prefer boring, explicit code** over clever abstractions. Add a package or dependency when something needs it, and no earlier.

Before you start, get the local setup from [Run your own Truman](/developers/run-your-own) working.

## Checks and tests

Run these before you open a pull request. The first three need nothing running, so you can repeat them as you work.

| Command                    | What it does                                                                                                   | Needs           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------- |
| `pnpm check`               | Formats and lints with Biome. `pnpm format` fixes what it can                                                  | Nothing         |
| `pnpm typecheck`           | Type-checks every package                                                                                      | Nothing         |
| `pnpm test`                | Unit tests, in files named `*.test.ts`                                                                         | Nothing         |
| `pnpm test:integration`    | Tests named `*.itest.ts`: the API against real Postgres and storage. Each file gets its own throwaway database | Docker services |
| `pnpm test:e2e`            | Playwright drives a real browser through the example study and the admin app, on a phone and a desktop         | Docker services |
| `pnpm test:e2e:built`      | The same browser tests against production builds                                                               | Docker services |
| `pnpm check:container`     | Builds the API's container image and checks it works                                                           | Docker          |
| `pnpm study test <folder>` | Runs one study's `scenarios.yaml`                                                                              | Docker services |

"Docker services" means the local Postgres and storage, which you start with:

```
docker compose up --detach --wait
```

CI runs these checks and tests on each pull request. The example studies' scenarios run there as part of the integration tests. CI doesn't deploy.

::: warning Two things about the tests that catch people out

- Integration and browser tests connect to the database as `truman_app`, the limited login production uses. Something that only works as the database's owner fails there.
- In CI, the browser tests are split across several jobs, each with its own database. A test file can't count on another having run first.

:::

## Code rules

- **The API is the only path that changes study state.** Participants, agents, and admin tools all go through `apps/api`.
- **Shared types and schemas live in `packages/core`,** defined once with Zod.
- **Events are written only through `recordEvent`** in `packages/db`. A new event type starts in `packages/core/src/events.ts`.
- **Migrations are never edited once merged.** After changing `packages/db/src/schema.ts`, run `pnpm db:generate` to create one. Rules Drizzle can't express, such as triggers, go in a custom migration.
- **Relative imports include the `.ts` or `.tsx` extension.** Node runs the TypeScript directly ([ADR 1](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/adr/0001-typescript-monorepo.md)), so TypeScript features that need compiling, such as `enum`, aren't allowed.
- **Secrets go in `.env`,** which isn't committed. A new setting gets added to `.env.example`.

A few more come from how the system works:

- **Participant routes ask the API's clock** and never call `new Date()` themselves. Scenario tests depend on it.
- **Don't log IDs, tokens, or request bodies.** A log can't be cleaned when a participant withdraws. Use `describeError` when you log an error.
- **A new table that refers to a study or its versions** has to be added to the `delete_study` database function, in a new migration.

## Adding a feature

In Truman, a feature is one building block of a platform, such as likes or comments. A study turns features on or off by condition.

Adding one touches the places below. If you'd like something to copy, `flagging` is a small one.

| Part            | Where                                     | What to do                                                      |
| --------------- | ----------------------------------------- | --------------------------------------------------------------- |
| The definition  | `packages/core/src/features/catalog.ts`   | Add its name, description, version, and events                  |
| Events          | `packages/core/src/events.ts`             | Add any new event type                                          |
| What people see | `packages/ui/src/features/`               | A component that returns nothing when the feature is off        |
| Where it goes   | `packages/ui/src/layouts/`                | Put the component in every layout, so any mix of features works |
| The server      | `apps/api/src/actions/routes.ts`          | Add a route that starts by refusing when the feature is off     |
| Templates       | `packages/core/src/features/templates.ts` | Say which templates include it                                  |

Then add two tests: a component test that it disappears when off, and a server test that its route refuses when off.

There are a few rules for features to keep in mind:

- A layout only arranges. If a layout has an `if` about what a feature does, that belongs in the feature.
- Changing what a feature does means raising its version. Studies report the version they used.
- Never change how a launched layout looks. Add a new one and leave the old one in place.

The full list is in [docs/guides/adding-a-feature.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/guides/adding-a-feature.md).

## Credit

Truman was started by Dominic DiFranzo and Natalie Bazarova at the Cornell Social Media Lab, with support from NSF IIS-1405634. Truman 3 is a new codebase that builds on that work, and on ideas from [Truman Agents](https://github.com/Cornell-Design-AI-Group/TrumanAgents) by Qian Yang and the Cornell DesignAI Group.

Two rules follow from that:

- Keep the credit to Truman Agents when you use its ideas.
- If you port code from an older Truman repo, keep its copyright notices, including the Hackathon Starter notice.

## License

Truman is released under the [MIT license](https://github.com/Critical-Computing-Cadre/truman3/blob/main/LICENSE).
