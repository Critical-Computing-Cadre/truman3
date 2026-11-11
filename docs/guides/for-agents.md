# Agents

An AI agent, such as Claude, can help build and check studies. There are two ways to have one:
- **Claude in your own MCP client,** like Claude Code, through Truman's MCP server, with a personal access token (ADR 64).
- **"Draft from a brief"** on a draft's Agent page in the builder, which runs on the server with its Claude key and a budget (ADR 65).

Either way, the agent uses the same tools through the admin API, and the same limits apply. It can read and write drafts, check them, save versions, run scenario tests, and simulate participants. What it writes is marked as generated. It can't do anything that reaches real participants or their data: launching, stopping, deleting, withdrawing, downloading data, seeing or removing what participants write in shared worlds, Prolific, or approving what the cast says. It recommends those, and you do them.

What the agent is told about Truman is [`packages/agent-tools/guide.md`](../../packages/agent-tools/guide.md). Change it there, and both ways get the change. The tools are in `packages/agent-tools/src/tools.ts`.

## Connecting your own client

1. In the admin app, open **Access for agents** and create a token. Copy it; it's shown once.
2. Add Truman's MCP server to your client: it runs `node apps/mcp/src/main.ts` in a copy of this repository, with `TRUMAN_URL` (the server's address) and `TRUMAN_TOKEN` (the token). For Claude Code, from the repository folder:

   ```
   claude mcp add truman --env TRUMAN_URL=https://truman.example.edu --env TRUMAN_TOKEN=truman_pat_... -- node apps/mcp/src/main.ts
   ```

   Run it with `node` directly, not through `pnpm`: `pnpm` prints a line first, which the client would misread.
3. Revoke the token on the same page when you're done with it. Tokens last 90 days.
