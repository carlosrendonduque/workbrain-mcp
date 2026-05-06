#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WorkBrainClient } from "./client.js";
import { loadConfig } from "./config.js";
import * as composeContext from "./tools/compose-context.js";
import * as currentProject from "./tools/current-project.js";
import * as ingestPaste from "./tools/ingest-paste.js";
import * as linkDocuments from "./tools/link-documents.js";
import * as recordDecision from "./tools/record-decision.js";
import * as searchTool from "./tools/search.js";
import * as setActiveProject from "./tools/set-active-project.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new WorkBrainClient(config);

  const server = new McpServer(
    { name: "workbrain", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  ingestPaste.register(server, client);
  searchTool.register(server, client);
  setActiveProject.register(server, client);
  currentProject.register(server, client);
  recordDecision.register(server, client);
  linkDocuments.register(server, client);
  composeContext.register(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("workbrain MCP server connected (stdio)");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`workbrain MCP server failed: ${message}`);
  process.exit(1);
});
