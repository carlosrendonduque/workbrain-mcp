import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkBrainClient } from "../client.js";
import { getActiveProject } from "../state.js";
import { toolError, toolJson } from "./helpers.js";

const inputSchema = {
  projectSlug: z
    .string()
    .min(1)
    .optional()
    .describe("Defaults to the active project. Use set_active_project first if not passed."),
};

export function register(server: McpServer, client: WorkBrainClient): void {
  server.registerTool(
    "get_canon",
    {
      description:
        "START HERE in every new conversation. Returns the binding canon for the active project — conventions, guidelines and architecture (project-level, falling back to the canon domain), plus the client/project identity, stakeholders and the instructions_for_agent preamble. No RAG, no LLM, no focus document needed: cheap enough to call before you know which ticket you are working on. Call compose_context instead once you have a specific ticket.",
      inputSchema,
    },
    async (args) => {
      const projectSlug = args.projectSlug ?? getActiveProject();
      if (!projectSlug) {
        return toolError("No active project. Call set_active_project first or pass projectSlug.");
      }
      try {
        const result = await client.post("/api/context/canon", { projectSlug });
        return toolJson(result);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
