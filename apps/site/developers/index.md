---

title: Overview
description: What Truman is technically, where the code lives, and where to read next.
---

# Overview

Truman is a social media site that researchers build to run experiments. A participant joins a study, is put in a condition, and uses a feed that looks like a real platform. Everyone else on it is the study's cast, and everything they say was written ahead of time. What the participant does is recorded for analysis.

This section is for web developers and research software engineers who want to host Truman themselves, change it, or script it. We assume you know TypeScript and are comfortable on the command line. You don't need to know this codebase yet, and this page is the place to start.

::: tip If you only want to run a study
You don't need any of this. Start with [the guide](/guide/) and use the hosted version at [app.truman-research.org](https://app.truman-research.org/admin/).
:::

## What it's made of

The code is at [github.com/Critical-Computing-Cadre/truman3](https://github.com/Critical-Computing-Cadre/truman3), under the MIT license. It's one pnpm monorepo, and all of it is TypeScript. Node 24 runs the TypeScript directly, so the server has no build step.

Here's the stack, layer by layer:

| Layer            | What it uses                                                       |
| ---------------- | ------------------------------------------------------------------ |
| API              | Hono with zod-openapi. It serves its own OpenAPI spec              |
| Database         | Postgres, through Drizzle                                          |
| File storage     | S3, or SeaweedFS on your own computer                              |
| Web apps         | React, built with Vite, with TanStack Query                        |
| Checks and tests | Biome, Vitest, and Playwright                                      |
| Cloud            | AWS, written in CDK: ECS Fargate, RDS Postgres, S3, and CloudFront |

## Where things live

When you first open the repo, there are three folders to know.

`apps/` holds what runs:

- `apps/api` is the API. It's the only thing that changes study state.
- `apps/participant` is the React app participants use.
- `apps/admin` is the React app researchers use. It's always served under `/admin/`.
- `apps/cli` is the command line: `pnpm study` and `pnpm admin`.
- `apps/mcp` is an MCP server, so an AI agent can build and check studies.

`packages/` holds what the apps share. The two you'll meet first are `packages/core`, which has the Zod schemas for a study and for events, and `packages/db`, which has the database schema and migrations. The rest are listed in [How it's built](/developers/architecture).

`studies/` holds studies as folders of CSV and YAML files. `studies/examples` has five finished ones, and `studies/starters` has sample content for each kind of site.

Two more folders matter later: `infra/` is the AWS deployment, and `e2e/` is the browser tests.

## The ideas to hold on to

Most of the code you'll read makes sense once you know these five things.

- **A study is data.** It's a definition that can be checked and frozen as a version. Nobody forks the code to run a study.
- **Everything goes through one API.** Participants, the cast, researchers, and agents all change state through `apps/api`.
- **The event log is the record.** What happens in a study is written to a table that can only be added to. Exports come from it.
- **Each participant gets their own world,** unless the study shares worlds between several people.
- **The director has no worker or scheduler.** It's called Christof, and it decides what's due when a page loads.

## The pages in this section

You don't have to read these in order. Pick the one that matches what you're trying to do.

| Page                                             | Read it when                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| [Run your own Truman](/developers/run-your-own)  | You want it on your laptop, or on your own servers                      |
| [How it's built](/developers/architecture)       | You want to know how a request, a world, and the event log fit together |
| [Studies as files](/developers/study-files)      | You want to write or version a study as a folder, and use `pnpm study`  |
| [The API and agents](/developers/api-and-agents) | You want to script Truman, or connect an AI agent to it                 |
| [Contributing](/developers/contributing)         | You want to send a change                                               |

## Deeper docs in the repo

The pages here are a summary. The full docs are Markdown files in the repo, kept next to the code they describe, so that's where to go once you need the detail.

| Doc                                                                                                                              | What's in it                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [docs/architecture.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/architecture.md)                       | The map of every app, package, and table that matters                          |
| [docs/cloud.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/cloud.md)                                     | How it runs on AWS, piece by piece                                             |
| [docs/guides/deploying.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/guides/deploying.md)               | The commands and settings for a deployment                                     |
| [docs/guides/hosting.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/guides/hosting.md)                   | Running a Truman that other labs apply to use                                  |
| [docs/guides/restoring.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/guides/restoring.md)               | Checking a database backup restores                                            |
| [docs/guides/testing-studies.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/guides/testing-studies.md)   | Scenario tests, simulated participants, and personas                           |
| [docs/guides/writing-beats.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/guides/writing-beats.md)       | The `beats.yaml` format                                                        |
| [docs/guides/adding-a-feature.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/guides/adding-a-feature.md) | Every place a new feature touches                                              |
| [docs/guides/for-agents.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/guides/for-agents.md)             | Connecting an AI agent                                                         |
| [docs/adr/](https://github.com/Critical-Computing-Cadre/truman3/tree/main/docs/adr)                                              | One short record for each decision, with the alternatives that were considered |

::: tip When you wonder why something is the way it is
Look in `docs/adr/` first. The records are numbered, and the other docs cite them by number.
:::
