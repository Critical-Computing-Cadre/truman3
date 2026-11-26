# How Truman 3 is developed and tested

How a change gets from an idea to hosted Truman, and what checks it on the way. The numbers are as of **2026-11-25**, counted from the repository.

## The model in one paragraph

Every change is a pull request with a plain-language summary and a note of how it was tested. CI runs the whole test suite on it. A choice someone might later question is written down as a decision record. A merge deploys to staging automatically, and production waits for a person to approve it. Database changes only ever add things, so a deploy never has to stop the service.

## Tests

| Suite             | What it covers                                                                                       | How many                       | Command                 |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------- |
| Checks            | Formatting and lint, with Biome                                                                      | Every file                     | `pnpm check`            |
| Types             | TypeScript's type checker, over every package                                                        | Every package                  | `pnpm typecheck`        |
| Unit tests        | Pure logic: study validation, feed assembly, schemas, the writer, and components                     | 753 tests in 63 files          | `pnpm test`             |
| Integration tests | The API against a real Postgres and real file storage, each file in its own throwaway database       | 805 tests in 65 files          | `pnpm test:integration` |
| Browser tests     | Playwright drives a real browser through whole studies and the admin app, at phone and desktop sizes | 166 tests in 38 files, 115 run | `pnpm test:e2e`         |
| Built apps        | The same browser tests against production builds of the apps                                         | The same                       | `pnpm test:e2e:built`   |
| Container         | Builds the API's container image and proves it starts and answers, with the limited database login   | One script                     | `pnpm check:container`  |
| Scenario tests    | Each reference study's own tests: "a participant does this, then that should happen"                 | 4 studies                      | `pnpm study test`       |

A few things about how the tests are written:

- **Integration and browser tests connect as the limited database login** production uses, not as the owner. Something that only works with more rights fails there.
- **The database has rules of its own,** tested directly: the event log can only be added to, a saved study version can't change, and deleting a participant's data goes through one function.
- **Time is under test.** Participant routes ask the API's clock, so a test can move a participant three days into a study.
- **AI features are tested with a stand-in model,** so tests are repeatable and cost nothing. They have not all been run against a real model. Where that's so, the pull request says it.
- **Every pull request says what wasn't tested,** as well as what was.
- **Browser tests are counted across two sizes.** A test that only needs one size skips the other, which is why 115 of the 166 run.

## Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request:

| Job           | What it does                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `checks`      | Installs from the lockfile, then checks, types, unit tests, a build of every app, and a synth of the infrastructure code with no AWS credentials |
| `container`   | Builds the API's container and runs it the way production does                                                                                   |
| `integration` | Starts Postgres and storage, runs the migrations, runs the integration tests, then starts the API and checks it's ready                          |
| `e2e`         | The browser tests, in six jobs: three shards against the apps as developed, three against production builds                                      |

A merge into `main` runs `checks` again on the merged code. Changes to documentation alone skip CI.

## Deploys

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), described in [ADR 88](adr/0088-deploys-from-github.md) and [cloud.md](cloud.md):

1. **A merge into `main` deploys staging,** after the quick checks pass on the merged code.
2. **Production waits for a person,** who approves the run in GitHub. Only the newest merge can be approved, so production can't be put back by approving an old run.
3. **GitHub holds no AWS keys.** Each job proves to AWS which repository and environment it's running in, and gets a short-lived role for that stage only. A pull request can't deploy, and neither can a fork.
4. **A deploy that would widen access is refused in CI.** Changes to permissions or network rules need a person at a terminal, who reads the difference first.
5. **The database is updated by the deploy,** before the new API starts. Migrations only add things ([ADR 86](adr/0086-a-deploy-updates-the-database-itself.md)), so the old API keeps working on the new tables while the new one starts. There are 75 migrations, and the rule is that one is never edited after it's merged.
6. **Backups** are automatic, kept 7 days on staging and 30 on production, and a restore has been checked on both ([restoring.md](guides/restoring.md)).

## Decision records

A choice someone might later question gets a short record in [`docs/adr`](adr): the context, the decision, the alternatives considered, and the consequences. There are 103. They're written with the change that makes the decision, in the same pull request, and they aren't rewritten afterwards: a later change of mind gets a new record that says so.

## Dependencies

- **Installed from a lockfile,** in CI and in the container build.
- **New dependencies have to be at least two weeks old** when they're added, so a package published and pulled within days never gets in.
- **Install scripts are off,** since they can run anything (`pnpm-workspace.yaml`).
- **Added when something needs them,** not in advance.

## Releases

Hosted Truman runs `main`, a merge at a time, after approval. Tagged releases are for people who run their own, and for citing a fixed version:

- **A release is a tag on `main`,** with notes in [CHANGELOG.md](../CHANGELOG.md) and on GitHub Releases.
- **[FEATURES.md](../FEATURES.md) is updated with it,** so the list of what Truman does is dated to a release.
- **Saved studies outlive releases.** A study version records the layout and feature versions it was built with, and a launched layout is never changed, so a study replicated later looks as it did.

## Security

- **Problems are reported privately** ([SECURITY.md](../SECURITY.md)).
- **GitHub's secret scanning and push protection are on** for the repository.
- **Secrets never go in the repository.** Local settings are in `.env`, which isn't committed, and hosted Truman's are in AWS Secrets Manager.

## Who does the work

Truman 3 has one maintainer, who reviews and merges every change ([GOVERNANCE.md](../GOVERNANCE.md)). Much of the code was written with an AI coding assistant under his review, which commits record in a `Co-Authored-By` line. That's a reason the habits above are strict: tests for every behavior, a written reason for every choice, and a plain summary of every change, so the project can be followed by people who weren't there.
