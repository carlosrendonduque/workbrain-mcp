#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { WorkBrainClient } from "./client.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  // Construct the client up front so a misconfiguration fails immediately.
  // Tools that use it are wired in Task 1.12.
  void new WorkBrainClient(config);

  const server = new Server(
    { name: "workbrain", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // Tool registry is empty in Task 1.11 — Task 1.12 fills it.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("workbrain MCP server connected (stdio)");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`workbrain MCP server failed: ${message}`);
  process.exit(1);
});
