---

title: The API and agents
description: Truman's HTTP API and OpenAPI spec, personal access tokens and their limits, and the MCP server that lets an AI agent build studies.
---

# The API and agents

Everything the two web apps do, they do through one HTTP API. You can call the same API from a script, and an AI agent can call it through Truman's MCP server.

## The HTTP API

The API is `apps/api`, built with Hono and zod-openapi. Each route is declared with Zod schemas for what it takes and returns, and the OpenAPI spec is made from those declarations ([ADR 3](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/adr/0003-hono-zod-openapi.md)).

The spec is served by the API itself, as OpenAPI 3.0:

```
GET /api/openapi.json
```

On a local setup that's `http://localhost:3000/api/openapi.json`. Point any OpenAPI client or viewer at it.

The API answers under `/api`, which is what browsers use, and at bare paths, which health checks use (`/health` and `/health/ready`).

Routes fall into two groups:

- **Participant routes,** such as `POST /api/studies/{slug}/enter` and `GET /api/feed`. They use the `session` cookie a participant gets when they enter a study.
- **Admin routes,** under `/api/admin/`. They use the `researcher_session` cookie from signing in to the admin app, or a personal access token.

Every admin route checks the researcher's role on the team that owns the study: owner, editor, or viewer.

## Personal access tokens

A token lets a script or an agent act as a researcher without a browser ([ADR 64](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/adr/0064-agents-work-through-tokens-and-an-mcp-server.md)).

To get one, open **Access for agents** in the admin app and create a token. It starts with `truman_pat_` and it's shown once. The server keeps only a hash. A token lasts 90 days unless you choose otherwise, up to a year, and you can revoke it on the same page.

Send it as a bearer token:

```
curl -H "Authorization: Bearer truman_pat_..." https://truman.example.edu/api/admin/studies
```

The API treats the request as coming from the researcher who made the token, with their access.

### What a token can't do

Anything that reaches real participants or their data is for a person in the admin app. The server refuses these from a token, with a 403:

- launching, stopping, or deleting a study
- withdrawing a participant
- downloading data, or participants' photos
- seeing or removing what participants write in shared worlds
- anything to do with Prolific
- approving what the cast says to participants, and changing the director's live controls
- making or revoking tokens
- managing a team's members, invitations, or Claude key

The list is in one place, `apps/api/src/admin/tokens.ts`, and it's checked before any route runs. So the limits hold whatever is calling: the MCP server, a script, or anything else.

A token can do the rest. It can read and write drafts, check them, save versions, run scenario tests, simulate participants, and read the Monitor page's counts.

Items a token adds to a draft are marked as generated, with the token's name, so a methods section can say what was generated.

## The MCP server

`apps/mcp` is an MCP server. An MCP client, such as Claude Code or Claude Desktop, runs it as a program on your own computer. It talks to a Truman server through the admin API with your token.

It needs a copy of the repo and two settings:

- `TRUMAN_URL`: the Truman server's address
- `TRUMAN_TOKEN`: your token

For Claude Code, from the repo's folder:

```
claude mcp add truman --env TRUMAN_URL=https://truman.example.edu --env TRUMAN_TOKEN=truman_pat_... -- node apps/mcp/src/main.ts
```

Run it with `node` directly. `pnpm` prints a line of its own first, which the client would misread.

### The tools

The tools are defined once, in `packages/agent-tools/src/tools.ts`.

| Tool                                      | What it does                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `list_studies`, `list_packs`              | Lists the researcher's studies, and the content packs a study can start from              |
| `start_study`, `open_draft`, `read_draft` | Starts a study, opens its draft, and reads everything in it along with the problems found |
| `add_item`, `change_item`, `remove_item`  | Edits the cast, posts, comments, and other items                                          |
| `save_settings`, `write_page`             | Saves a section of settings, or a page such as `beats.yaml` or the consent page           |
| `save_version`                            | Freezes the draft as a version                                                            |
| `run_scenarios`, `simulate`               | Runs the version's scenario tests, or sends simulated participants through it             |
| `monitor`                                 | Reads a running study's Monitor page, which has counts only                               |
| `call_api`                                | Calls anything else under `/admin/` in the API                                            |
| `recommend_to_researcher`                 | Tells the researcher what to do next, and does nothing itself                             |

`call_api` is safe to have because the server enforces the limits on every path. `recommend_to_researcher` is how an agent handles what it can't do: it says what should happen, why, and where in the admin app, and a person does it.

The agent also gets a guide to Truman, [packages/agent-tools/guide.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/packages/agent-tools/guide.md). It says how a study is put together and how to work well. It's a good short overview for a person too. Change it there to change what every agent is told.

## Draft from a brief

Many researchers won't run an MCP client. For them, each draft in the builder has an Agent page, and the New Study page takes a brief ([ADR 65](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/adr/0065-draft-from-a-brief.md)). A researcher describes what they want: a whole study, personas to pilot it, or scenario tests for its beats.

It works like this:

- It runs on the server as a background job, with a Claude key, and the page shows each step as it happens.
- It has a budget for each run, $2 unless the researcher changes it. It stops when the budget is reached.
- It uses the same tools as the MCP server, through the admin API, with a token made for the run and revoked when it ends. So the limits above apply to it too.
- Each run is recorded in `agent_runs`: what was asked, each tool used, the cost, and why it stopped.

## Where to read more

- [docs/guides/for-agents.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/guides/for-agents.md) is the repo's guide to both ways of having an agent.
- [Studies as files](/developers/study-files) covers the command line, which is the other way to script Truman. It works on the database directly, so it's for whoever runs the server.
