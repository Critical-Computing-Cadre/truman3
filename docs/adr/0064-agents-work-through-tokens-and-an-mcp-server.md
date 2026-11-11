# 64. Agents work through tokens and an MCP server

## Context

Phase 4 of the design plan: agents that help researchers build and run studies. The vault note `Researcher agents design` set the plan, and Dominic answered its questions:
- **Limits:** an agent can't do anything that reaches real participants or their data. It can recommend those things, and the researcher does them.
- **Where it runs:** on the researcher's own computer, at first. A hosted Truman for other labs is a later project.
- **A "Draft from a brief" button** in the builder is a key feature too, and should help write simulations. That's a separate change.
- **Generated images** come later, with a budget and guardrails.

Everything an agent needs to build a study is already in the admin API: drafts, items, settings and pages, versions, scenario tests, simulations, and the Monitor page's counts. What was missing was a way in for something that isn't a browser, and a description of Truman an agent can read.

## Decision

- **Personal access tokens.**
  - **Getting one:** a researcher makes one on the admin app's new **Access for agents** page. It starts with `truman_pat_`, so it's easy to recognize and scan for, and it's shown once.
  - **Storage:** only a hash is kept.
  - **Lifetime:** 90 days unless set otherwise, at most a year. It can be revoked at once, and when it was last used is recorded.
  - **Use:** an agent sends it as `Authorization: Bearer`, and the API treats it as that researcher.
- **What a token can't do** is listed in one place, `apps/api/src/admin/tokens.ts`, and refused before any route runs:
  - launching, stopping, or deleting a study
  - withdrawing someone
  - downloading data or participants' photos
  - Prolific
  - approving what the cast says to participants, or changing Christof's controls
  - managing tokens

  The refusal says a researcher does it and an agent can recommend it.
- **What an agent writes is marked.** Items an agent adds to a draft have the provenance `generated`, with the token's name, so a methods section can say what was generated.
- **An MCP server, `apps/mcp`,** run by an MCP client on the researcher's computer with `node apps/mcp/src/main.ts`, `TRUMAN_URL`, and `TRUMAN_TOKEN`.
  - It has tools for the usual work: read the guide, list studies and packs, start a study, read and change a draft, write `beats.yaml` and the other pages, save a version, run its scenario tests, simulate, and read the Monitor page.
  - `call_api` reaches anything else under `/admin/`.
  - `recommend_to_researcher` puts a recommendation in front of the researcher, and does nothing itself.
- **A guide for agents,** `docs/guides/for-agents.md`, served as a resource and a tool, so an agent can learn how a study is put together and what it may do.
- **Saving a version returns its id,** so an agent can test and simulate what it just saved.

## Alternatives

- **Using the admin app's cookie.** Cookies are for browsers, last as long as a session, and can't be told apart from the researcher. A token can be named, limited, and revoked on its own.
- **A token for one team.** The design note suggested it. Checking a token's team would mean changing every place access is checked, and most researchers are on one team. A token can reach what its researcher can.
- **Hosting the MCP server in the API.** That needs sign-in through OAuth for each client. A local program is simpler and is what Dominic chose to start with. The hosted Truman for other labs will need it.
- **Leaving out `call_api`.** Fewer tools are easier for a model to choose from. But the API keeps growing, and the server enforces the limits whatever the path, so one general tool is safe and saves listing everything.

## Consequences

- Migration 0050 adds `researcher_tokens`.
- `apps/mcp` adds `@modelcontextprotocol/sdk`, the official SDK for MCP, and the packages it brings, used only there.
- The "Draft from a brief" button comes next, using the server's Claude key and a budget.
