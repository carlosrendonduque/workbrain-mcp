import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkBrainClient } from "../client.js";
import { toolError, toolJson } from "./helpers.js";
import { getActiveProject } from "../state.js";

const inputSchema = {
  focusExternalId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "External ID of the document the user is about to work on (e.g. 'TICKET-1234'). The full document plus its linked documents and similar chunks will be returned.",
    ),
  focusText: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Free-form text describing what the user is working on (a question, a code snippet, a selection). Used as the RAG query when there is no focus document.",
    ),
  topK: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Default 8 — number of RAG chunks to include."),
  minSimilarity: z.number().min(0).max(1).optional().describe("Default 0.3."),
  projectSlug: z
    .string()
    .min(1)
    .optional()
    .describe("Defaults to the active project. Use set_active_project first if not passed."),
};

export function register(server: McpServer, client: WorkBrainClient): void {
  server.registerTool(
    "compose_context",
    {
      description:
        "FLAGSHIP: assemble the full context the IDE coding agent needs to work a ticket. Returns canon (conventions, guidelines, architecture), focus document with frontmatter, linked documents grouped by type, RAG-retrieved chunks (reranked), stakeholder profiles, and a pre-formatted instructions_for_agent block. No LLM call — pure structural composition. Provide either focusExternalId (when working a known ticket) or focusText (when starting from a question or code snippet).",
      inputSchema,
    },
    async (args) => {
      const projectSlug = args.projectSlug ?? getActiveProject();
      if (!projectSlug) {
        return toolError("No active project. Call set_active_project first or pass projectSlug.");
      }
      try {
        const result = await client.post("/api/context/compose", { ...args, projectSlug });
        return toolJson(result);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
