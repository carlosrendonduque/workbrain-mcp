import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkBrainClient } from "../client.js";
import { toolError, toolJson } from "./helpers.js";
import { getActiveProject } from "../state.js";

interface ProjectListItem {
  projectSlug: string;
  projectName: string;
}

export function register(server: McpServer, client: WorkBrainClient): void {
  server.registerTool(
    "current_project",
    {
      description:
        "Return the active project for this MCP session, or null if none is set. Cheap to call.",
      inputSchema: {},
    },
    async () => {
      try {
        const slug = getActiveProject();
        if (!slug) {
          return toolJson({ projectSlug: null, projectName: null });
        }
        const projects = await client.get<ProjectListItem[]>("/api/projects");
        const found = projects.find((p) => p.projectSlug === slug);
        return toolJson({
          projectSlug: slug,
          projectName: found?.projectName ?? null,
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
