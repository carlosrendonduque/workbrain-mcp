#!/usr/bin/env node
// End-to-end MCP smoke test for Task 1.12.
//
// Spawns the built MCP server over stdio and exercises:
//   1. tools/list  — must return all 4 tools
//   2. set_active_project("project-x")
//   3. current_project — should now report project-x
//   4. search("voyage embeddings audit row") — should return chunks
//
// Requires the backend to be running on WORKBRAIN_API_URL and a real
// WORKBRAIN_API_KEY in the environment.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "index.js");

const apiUrl = process.env.WORKBRAIN_API_URL ?? "http://localhost:3000";
const apiKey = process.env.WORKBRAIN_API_KEY;
if (!apiKey) {
  console.error("set WORKBRAIN_API_KEY before running the smoke test.");
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, WORKBRAIN_API_URL: apiUrl, WORKBRAIN_API_KEY: apiKey },
  stderr: "pipe",
});

const client = new Client({ name: "workbrain-smoke", version: "0.1.0" });

function parseToolText(result) {
  const first = result.content?.[0];
  if (!first || first.type !== "text") return null;
  try {
    return JSON.parse(first.text);
  } catch {
    return first.text;
  }
}

try {
  await client.connect(transport);
  console.log("✅ initialize");

  // 1. tools/list
  const tools = await client.listTools();
  console.log(`✅ tools/list returned ${tools.tools.length} tool(s):`);
  for (const t of tools.tools) {
    console.log(`     - ${t.name}`);
  }
  if (tools.tools.length !== 4) {
    throw new Error(`expected 4 tools, got ${tools.tools.length}`);
  }

  // 2. set_active_project
  const setResult = await client.callTool({
    name: "set_active_project",
    arguments: { projectSlug: "project-x" },
  });
  if (setResult.isError) throw new Error(`set_active_project failed: ${parseToolText(setResult)}`);
  const setBody = parseToolText(setResult);
  console.log(`✅ set_active_project -> ${setBody?.projectSlug} (${setBody?.projectName})`);

  // 3. current_project
  const currentResult = await client.callTool({ name: "current_project", arguments: {} });
  if (currentResult.isError)
    throw new Error(`current_project failed: ${parseToolText(currentResult)}`);
  const currentBody = parseToolText(currentResult);
  console.log(`✅ current_project -> ${currentBody?.projectSlug}`);

  // 4. search
  const searchResult = await client.callTool({
    name: "search",
    arguments: { query: "voyage embeddings audit row", topK: 3, minSimilarity: 0.4 },
  });
  if (searchResult.isError) throw new Error(`search failed: ${parseToolText(searchResult)}`);
  const searchBody = parseToolText(searchResult);
  const chunks = searchBody?.chunks ?? [];
  console.log(`✅ search returned ${chunks.length} chunk(s):`);
  for (const c of chunks) {
    console.log(`     - ${c.externalId} sim=${c.similarity.toFixed(3)}`);
  }
  if (chunks.length === 0) {
    throw new Error("expected at least 1 chunk for 'voyage embeddings audit row' in project-x");
  }
} finally {
  await client.close();
}
