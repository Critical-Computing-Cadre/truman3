import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AGENT_TOOLS, type TrumanClient } from "@truman3/agent-tools";

/**
 * Truman's MCP server: the tools in @truman3/agent-tools, for an agent helping a researcher build and
 * check studies, through the admin API with their personal access token. Anything that reaches real
 * participants is for the researcher to do, and the server refuses it from a token. An agent
 * recommends it instead, with recommend_to_researcher. See ADR 64.
 */

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Runs a tool, turning a refusal or a problem into a message the agent can act on. */
async function run(work: () => Promise<unknown>): Promise<Result> {
  try {
    const value = await work();
    return {
      content: [
        { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  }
}

export function createTrumanServer(client: TrumanClient, guide: string): McpServer {
  const server = new McpServer({ name: "truman", version: "0.1.0" });

  server.registerResource(
    "guide",
    "truman://guide",
    {
      title: "How to work in Truman",
      description: "What Truman is, how a study is put together, and what an agent may do.",
      mimeType: "text/markdown",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide }] }),
  );
  server.registerTool(
    "guide",
    {
      title: "Read the guide",
      description:
        "Read this first. How Truman studies are built, the files and their formats, and what you may and may not do for the researcher.",
    },
    async () => ({ content: [{ type: "text", text: guide }] }),
  );

  for (const tool of AGENT_TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.input },
      (input: unknown) => run(() => tool.run(client, input as never)),
    );
  }
  return server;
}
