---

title: How it's built
description: The apps and packages, how a request flows, and how worlds, the director, and the event log work.
---

# How it's built

This page is a short tour of the codebase: what the apps and packages are, how a request gets from a browser to the database, and how the parts that are particular to Truman work. Those are worlds, the director, and the event log.

It's meant to get you oriented. The full map is [docs/architecture.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/architecture.md), and the reasons behind each choice are in the [ADRs](https://github.com/Critical-Computing-Cadre/truman3/tree/main/docs/adr).

## Apps

Everything that runs lives under `apps/`.

| Path               | What it is                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `apps/api`         | The Hono API. The only thing that changes study state                                                          |
| `apps/participant` | The React app participants use: joining, consent, the feed, profiles, messages                                 |
| `apps/admin`       | The React app researchers use, under `/admin/`: the builder, the Monitor page, Prolific                        |
| `apps/cli`         | `pnpm study` and `pnpm admin`                                                                                  |
| `apps/mcp`         | An MCP server an AI agent runs to build and check studies                                                      |
| `apps/mobile`      | An Expo shell around the participant site, with push notifications. Its own npm project, outside the workspace |
| `apps/site`        | This site, built with VitePress                                                                                |

Both web apps build to static files. Neither has an address built in. Instead, each calls `/api` on whatever address it's served from.

## Packages

The code the apps share lives under `packages/`.

| Path                    | What it is                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/core`         | Zod schemas and types: the study definition and its checks, the event catalog, features and templates |
| `packages/db`           | The Drizzle schema, migrations, and `recordEvent`                                                     |
| `packages/feed`         | What a viewer sees and in what order, as plain functions                                              |
| `packages/ui`           | The feed and the page around it, drawn the same way in both apps                                      |
| `packages/study-files`  | Reads study folders. Converts older Truman studies                                                    |
| `packages/study-import` | Freezes a study as a version. Launches, stops, and withdraws                                          |
| `packages/drafts`       | A study being edited in the builder, saved item by item, with history                                 |
| `packages/study-export` | Writes a study's data as CSVs with a codebook                                                         |
| `packages/storage`      | File storage over S3                                                                                  |
| `packages/accounts`     | Teams, researcher accounts, and passwords                                                             |
| `packages/recruit`      | The Prolific client and encrypted tokens                                                              |
| `packages/writer`       | The gateway to Claude, and a stand-in for tests                                                       |
| `packages/agent-tools`  | The tools an AI agent gets, and the guide it reads                                                    |

The web apps import no server code. They reach the API over HTTP, like any other client.

## A request

Here's the path a request takes:

```
browser ─ /api/... ─▶ apps/api ─▶ packages/db ─▶ Postgres
                          └─────▶ packages/storage ─▶ S3
```

Locally, each Vite dev server forwards `/api` to the API on port 3000. On AWS, CloudFront does the same job.

Routes are built in `createApp`, in `apps/api/src/app.ts`. It takes what the routes need as arguments: the database, storage, the writer, and the clock. Tests pass in their own.

## Why everything goes through the API

Participants, the cast, researchers, the command line's scenario runner, and AI agents all change study state through `apps/api`. We hold to this rule because it gives us one place where three things happen:

- The server checks the request. A route for a feature that's turned off refuses, so hiding a button is never the only control.
- The change and its event are written in the same transaction, so they can't disagree.
- Limits apply to every caller. An agent's token is refused on the same routes whether it comes through the MCP server or a script.

## Worlds and participants

A participant opens a link like `/join/eatsnap?PROLIFIC_PID=...`. There's no password or email. The API looks up the recruitment ID, and if this is someone new, it enrolls them in one transaction: a condition, a world, and an actor for them in that world ([ADR 9](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/adr/0009-participant-entry.md)).

A world is one participant's copy of the study, started when they enroll. The study's posts appear at times measured from the world's start. What the participant writes belongs to their world, so nobody else sees it.

A study can share worlds instead. Then several participants are in one world and see each other ([ADR 67](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/adr/0067-shared-worlds.md)). Live updates in a shared world come as server-sent events from `GET /api/live`.

The feed itself is built by `GET /api/feed`. It works out what's visible now in this world and condition, then orders it with a ranker from `packages/feed`. What was shown is written to `feed_impressions`, with the order, so the data says what each person saw.

## Christof, the director

Christof makes things happen in a world, working from what the study wrote in `beats.yaml`. A beat is one thing a cast member does: a post, comment, like, repost, or follow. It's set off by a time, by something the participant did, or by another beat ([ADR 51](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/adr/0051-christof-beats-and-the-director.md)).

You might expect a background worker or a scheduler here. There isn't one. It runs like this:

1. When the participant does something, the beats it sets off are written to `beat_runs` as pending, with when each is due.
2. When a page loads, the API calls `catchUp` in `apps/api/src/director/director.ts`. It decides each beat that has come due, oldest first.
3. Each decision is a row in `beat_runs`: fired or skipped, and why. That trace is in the export.
4. What a beat makes appears at the time it was due, however late the page load was.

A beat can also ask a model to write its words. That's off unless the study turns it on, it has a budget, and every such beat has a fallback line. A second model call checks each line before it's posted ([ADR 52](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/adr/0052-christof-actors-write-live.md)). No page waits for a model.

The API takes its clock as a setting. Scenario tests move that clock forward step by step, so a two-day study runs in a moment ([ADR 56](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/adr/0056-scenario-tests-and-the-api-clock.md)).

::: warning Ask the clock
One rule follows from this: participant routes ask the clock and never call `new Date()` themselves.
:::

## The event log

Events are written only through `recordEvent` in `packages/db/src/events.ts`. It checks each payload against the catalog in `packages/core/src/events.ts`, so a new event type starts there.

The `events` table is append-only, and the database enforces that. Database triggers refuse updates, deletes, and truncation, and the API's database login can only read and add to it ([ADR 6](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/adr/0006-append-only-event-log.md)).

Everything a participant does goes in, along with scripted reactions to them and what a researcher does. Scripted content appearing on schedule isn't an event, since the frozen version already says when it appears.

There's one way to delete events. When a participant withdraws, the database function `delete_participant_data` deletes their rows and records the deletion. The API's login may call that function and nothing else that deletes.

## Drafts and versions

A study reaches participants by one of two routes, and both end in a frozen version:

```
draft ──save──▶ frozen version ──launch──▶ live
study folder ──import──▶ frozen version
```

A frozen version can't change. Database triggers refuse it. Saving and launching are separate steps, and people already in a study stay on the version they started with ([ADR 13](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/adr/0013-saving-and-launching-are-separate.md)).

[Studies as files](/developers/study-files) covers the folder side of this.
