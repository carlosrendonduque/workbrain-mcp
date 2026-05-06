import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkBrainClient } from "../client.js";
import { toolError, toolJson } from "./helpers.js";
import { getActiveProject } from "../state.js";

const inputSchema = {
  query: z.string().min(1).describe("Natural-language query."),
  types: z
    .array(z.string())
    .optional()
    .describe("Optional filter on document type (e.g. ['ticket'] to search only tickets)."),
  externalId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional exact-match filter on a document's external_id (e.g. 'TICKET-1234'). Useful to scope search to chunks of one specific document.",
    ),
  dateRange: z
    .object({
      from: z.string().optional().describe("ISO date YYYY-MM-DD (inclusive)."),
      to: z.string().optional().describe("ISO date YYYY-MM-DD (inclusive end-of-day)."),
    })
    .optional()
    .describe(
      "Optional ingestion date range filter (against documents.created_at). At least one of from / to must be set.",
    ),
  topK: z.number().int().min(1).max(50).optional().describe("Default 8."),
  minSimilarity: z.number().min(0).max(1).optional().describe("Default 0.3."),
  useRerank: z
    .boolean()
    .optional()
    .describe(
      "Default true — runs Voyage rerank-2 over the top 50 cosine candidates and returns the top-K reordered. Pass false for cheaper / faster cosine-only retrieval.",
    ),
  projectSlug: z
    .string()
    .min(1)
    .optional()
    .describe("Defaults to the active project. Use set_active_project first if not passed."),
};

export function register(server: McpServer, client: WorkBrainClient): void {
  server.registerTool(
    "search",
    {
      description:
        "Semantic search over the active project's corpus, filtered by project always. Returns the top-K chunks most similar to the query, each with documentPath, externalId, type, text and similarity. Cross-project results are never returned.",
      inputSchema,
    },
    async (args) => {
      const projectSlug = args.projectSlug ?? getActiveProject();
      if (!projectSlug) {
        return toolError("No active project. Call set_active_project first.");
      }
      try {
        const result = await client.post("/api/search", { ...args, projectSlug });
        return toolJson(result);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
