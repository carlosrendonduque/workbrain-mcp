import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkBrainClient } from "../client.js";
import { getActiveProject, getActiveProjectSource } from "../state.js";
import { toolError, toolJson } from "./helpers.js";

interface ProjectListItem {
  projectSlug: string;
  projectName: string;
}

export function register(server: McpServer, client: WorkBrainClient): void {
  server.registerTool(
    "current_project",
    {
      description:
        "Return the active project, or null if none is resolved. Cheap to call. `source` says where it came from: 'session' (set_active_project was called in this session), 'env' (WORKBRAIN_PROJECT_SLUG), 'directory' (a binding previously saved for this working directory), or 'none'.",
      inputSchema: {},
    },
    async () => {
      try {
        const slug = getActiveProject();
        const source = getActiveProjectSource();
        if (!slug) {
          return toolJson({ projectSlug: null, projectName: null, source });
        }
        const projects = await client.get<ProjectListItem[]>("/api/projects");
        const found = projects.find((p) => p.projectSlug === slug);
        return toolJson({
          projectSlug: slug,
          projectName: found?.projectName ?? null,
          source,
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
