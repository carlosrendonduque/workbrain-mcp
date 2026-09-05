#!/usr/bin/env node

// End-to-end MCP smoke test for Task 1.12.
//
// Spawns the built MCP server over stdio and exercises:
//   1. initialize  — must advertise server instructions
//   2. tools/list  — every tool in EXPECTED_TOOLS must be present
//   3. set_active_project("project-x")
//   4. current_project — should now report project-x
//   5. get_canon — should return the canon for project-x
//   6. search("voyage embeddings audit row") — should return chunks
//
// Requires the backend to be running on WORKBRAIN_API_URL and a real
// WORKBRAIN_API_KEY in the environment.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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

const EXPECTED_TOOLS = [
  "compose_context",
  "current_project",
  "get_canon",
  "ingest_paste",
  "link_documents",
  "record_decision",
  "search",
  "set_active_project",
];

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

  // The instructions block is what puts the "read the canon first" contract in
  // front of the agent on every machine — a silent regression here is invisible
  // until someone notices the agent skipping the canon, so assert it.
  const instructions = client.getInstructions();
  if (!instructions?.includes("get_canon")) {
    throw new Error("server did not advertise instructions mentioning get_canon");
  }
  console.log(`✅ instructions advertised (${instructions.length} chars)`);

  // 1. tools/list
  const tools = await client.listTools();
  console.log(`✅ tools/list returned ${tools.tools.length} tool(s):`);
  for (const t of tools.tools) {
    console.log(`     - ${t.name}`);
  }
  const missing = EXPECTED_TOOLS.filter((name) => !tools.tools.some((t) => t.name === name));
  if (missing.length > 0) {
    throw new Error(`missing tool(s): ${missing.join(", ")}`);
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

  // 5. get_canon — no focus document, no RAG
  const canonResult = await client.callTool({ name: "get_canon", arguments: {} });
  if (canonResult.isError) throw new Error(`get_canon failed: ${parseToolText(canonResult)}`);
  const canonBody = parseToolText(canonResult);
  if (!canonBody?.canon) throw new Error("get_canon returned no canon block");
  console.log(
    `✅ get_canon -> ${canonBody.client?.slug}/${canonBody.project?.slug}` +
      ` (conventions=${canonBody.canon.source?.conventions},` +
      ` guidelines=${canonBody.canon.source?.guidelines},` +
      ` architecture=${canonBody.canon.source?.architecture})`,
  );

  // 6. search
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
