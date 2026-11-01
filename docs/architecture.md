# Architecture

Truman 3 is a monorepo. This page separates what exists today from what's planned, so it's clear which is which.

## What exists today

Phase 0 is scaffolding. It has no study features yet.

| Path | What it is |
|---|---|
| `apps/api` | Hono API: health routes and the OpenAPI spec |
| `apps/participant` | React app for participants: a placeholder page for now |
| `apps/admin` | React app for researchers: a placeholder page for now |
| `packages/core` | Shared Zod schemas and types |
| `packages/db` | Postgres connection through Drizzle; no tables yet |
| `packages/ui` | Shared React components |
| `compose.yaml` | Local Postgres and S3-compatible storage |

A request today looks like this:

```
browser → Vite dev server (/api) → apps/api → packages/db → Postgres
```

## The ideas behind the design

- **A study is data, not a fork.** See [ADR 0005](adr/0005-studies-as-data.md).
- **Everything goes through one API.** Participants, LLM actors, admin tools, and outside agents all change state the same way, so all of it gets validated and logged the same way.
- **An actor has a driver.** Anyone in the feed is an actor, driven by a script, an LLM, or a human.
- **The event log is the source of truth.** See [ADR 0006](adr/0006-append-only-event-log.md).
- **A director runs the show.** The researcher's script decides whether and when things happen. The LLM decides what an actor says.

## Planned packages

These get added when their phase needs them, not before.

| Path | Purpose | Phase |
|---|---|---|
| `packages/feed` | Feed rankers and interventions | 1 |
| `apps/worker` | Scheduled jobs, director, and agent runtime | 1–3 |
| `packages/recruit` | Recruitment adapters, Prolific first | 2 |
| `packages/llm` | LLM gateway: any provider, call log, budgets | 3 |
| `packages/adapt` | Decision points and re-randomization | 3 |
| `packages/mcp` | MCP server for researcher agents | 4 |
| `packages/sdk` | TypeScript and Python clients generated from the OpenAPI spec | 4 |
| `apps/mobile` | Expo app | 6 |

## Roadmap

0. **Setup.** This scaffolding.
1. **Core + classic Truman.** Study schema, CSV importer, event log, participant feed, scripted actors, conditions, export.
2. **Admin tools.** Accounts, study builder, preview, live monitor, codebook, platform templates, Prolific.
3. **LLM actors + adaptive designs.** LLM gateway, director and beats, persona actors, decision traces, decision points.
4. **Researcher agents + external rankers.** MCP server and CLI, study drafting, simulated participants.
5. **Multi-user + modules.** Shared worlds, real-time updates, load testing.
6. **Mobile app.**
