import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkBrainClient } from "../client.js";
import { toolError, toolJson } from "./helpers.js";
import { getActiveProject } from "../state.js";

const inputSchema = {
  query: z.string().min(1).describe("Natural-language query."),
  types: z.array(z.string()).optional().describe("Optional filter on document type."),
  topK: z.number().int().min(1).max(50).optional().describe("Default 8."),
  minSimilarity: z.number().min(0).max(1).optional().describe("Default 0.3."),
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
