# 65. Draft from a brief

## Context

ADR 64 let an agent work in Truman through a researcher's own MCP client. In the vault note `Researcher agents design`, Dominic asked for a "Draft from a brief" button in the builder too. It's a key feature, since many researchers won't run an MCP client, and it should also help write simulations: personas and scenario tests.

## Decision

- **An Agent page for each draft, and a brief on the New study page.**
  - A researcher asks for anything an agent can do on that draft: draft a whole study from a brief, write personas to pilot it, write scenario tests for its beats, and so on.
  - Starting a study with a brief starts the agent on its new draft.
- **It runs on the server, with its Claude key,** as a background job, and the page shows each step as it happens.
  - **Model and budget:** Opus, $2 by default, up to $20, set for each run. It stops after the step that reaches the budget, or after 60 model calls.
  - **The record:** each run is a row in `agent_runs`: what was asked, each tool used and what came back, the cost, why it stopped, and what the agent said at the end.
- **The same tools and limits as the MCP server.**
  - The tools and the guide moved into `packages/agent-tools`, which both use. They're defined once.
  - A run works through the admin API, in-process, with a token made for it and revoked when it ends. So the limits in ADR 64 apply as they do to any agent: it can't launch, withdraw, export, or reach Prolific. It recommends those, and the recommendation is in its summary.
  - What it writes is marked as generated, with the run's token name, as with any agent.
- **Settings and pages an agent writes are marked as generated too,** not just items. When a person changes one later, it's marked as edited, as items already were.
- **The writer gets `runAgent`,** beside writing lines and playing personas, so a run can be tested with a scripted stand-in that uses the real tools. The real one uses the Anthropic SDK's tool runner, with adaptive thinking and the guide cached.
- **An agent can't start another agent** with its token.

## Alternatives

- **A fixed pipeline:** write the cast, then posts, then beats, then tests. A brief can ask for anything from a whole study to one fix, and the agent needs to read, check, and correct as it goes. A tool loop does that, and it's the same work the MCP server already does.
- **Calling the drafts package directly instead of the API.** It would be faster, but it would skip the API's checks and the limits on agents, and be a second path to keep in step. Going through the API in-process costs little.
- **Sonnet, to cost less.** Drafting a study is a long job with many steps, where a stronger model wastes fewer of them. The budget caps the cost either way.

## Consequences

- Migration 0051 adds `agent_runs`.
- `docs/guides/for-agents.md` now covers both ways to have an agent, and the guide the agent reads is `packages/agent-tools/guide.md`.
- Nothing has run with a real model yet; tests use a scripted agent. It needs trying on staging, which has a Claude key.
