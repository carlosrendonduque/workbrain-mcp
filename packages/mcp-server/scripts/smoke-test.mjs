#!/usr/bin/env node
// Spawn the built MCP server over stdio and ask it for tools/list.
// Verifies the AC of Task 1.11: server starts and responds to tools/list.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "index.js");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: {
    ...process.env,
    WORKBRAIN_API_URL: process.env.WORKBRAIN_API_URL ?? "http://localhost:3000",
    WORKBRAIN_API_KEY: process.env.WORKBRAIN_API_KEY ?? "wbk_smoke_test_key",
  },
  stderr: "pipe",
});

const client = new Client({ name: "workbrain-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  console.log("✅ initialize handshake completed");

  const tools = await client.listTools();
  console.log(`✅ tools/list returned ${tools.tools.length} tool(s):`);
  for (const t of tools.tools) {
    console.log(`   - ${t.name}: ${t.description ?? "(no description)"}`);
  }
} finally {
  await client.close();
}
