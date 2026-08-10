import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkBrainClient } from "../client.js";
import { setActiveProject } from "../state.js";
import { toolError, toolJson } from "./helpers.js";

interface ProjectListItem {
  projectSlug: string;
  projectName: string;
  clientSlug: string;
  clientName: string;
}

const inputSchema = {
  projectSlug: z.string().min(1).describe("Slug of the project to activate."),
};

export function register(server: McpServer, client: WorkBrainClient): void {
  server.registerTool(
    "set_active_project",
    {
      description:
        "Switch the active project. Validates that the slug exists in the user's project list before storing it. The choice is also saved for the current working directory, so future sessions started in this repo resolve the same project without being told again. Subsequent get_canon, compose_context, ingest_paste and search calls default to it.",
      inputSchema,
    },
    async ({ projectSlug }) => {
      try {
        const projects = await client.get<ProjectListItem[]>("/api/projects");
        const found = projects.find((p) => p.projectSlug === projectSlug);
        if (!found) {
          const available = projects.map((p) => p.projectSlug).join(", ") || "(none)";
          return toolError(`Project not found: ${projectSlug}. Available: ${available}`);
        }
        setActiveProject(projectSlug);
        return toolJson({
          projectSlug: found.projectSlug,
          projectName: found.projectName,
          clientSlug: found.clientSlug,
          clientName: found.clientName,
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
