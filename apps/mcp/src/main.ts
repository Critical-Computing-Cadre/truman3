import { readFileSync } from "node:fs";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { trumanClient } from "./client.ts";
import { createTrumanServer } from "./server.ts";

/**
 * Starts Truman's MCP server for an MCP client like Claude Code or Claude Desktop, which runs it as
 * a program on the researcher's own computer. It needs the Truman server's address and a personal
 * access token from the admin app's Access for agents page. See docs/guides/for-agents.md.
 */

const baseUrl = process.env.TRUMAN_URL;
const token = process.env.TRUMAN_TOKEN;
if (!baseUrl || !token) {
  // Standard error, since standard output is how the client talks to this program.
  console.error(
    "Set TRUMAN_URL to your Truman server's address and TRUMAN_TOKEN to a token from its Access for agents page.",
  );
  process.exit(1);
}

const guide = readFileSync(
  path.resolve(import.meta.dirname, "../../../docs/guides/for-agents.md"),
  "utf8",
);
const server = createTrumanServer(trumanClient({ baseUrl, token }), guide);
await server.connect(new StdioServerTransport());
