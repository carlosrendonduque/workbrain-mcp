import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkBrainClient } from "../client.js";
import { toolError, toolJson } from "./helpers.js";
import { getActiveProject } from "../state.js";

const LINK_TYPES = [
  "depends_on",
  "related",
  "supersedes",
  "discusses",
  "decided_in",
  "references",
] as const;

const inputSchema = {
  linkType: z
    .enum(LINK_TYPES)
    .describe(
      "Relationship type. depends_on / related / supersedes / discusses / decided_in / references.",
    ),
  fromExternalId: z
    .string()
    .min(1)
    .optional()
    .describe("External ID of the source document. Provide either this or fromPath, not both."),
  fromPath: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Corpus-relative path of the source document (e.g. 'client-a/project-x/tickets/TICKET-1234.md'). Provide either this or fromExternalId, not both.",
    ),
  toExternalId: z
    .string()
    .min(1)
    .optional()
    .describe("External ID of the target document. Provide either this or toPath, not both."),
  toPath: z
    .string()
    .min(1)
    .optional()
    .describe("Corpus-relative path of the target document. Provide either this or toExternalId."),
  note: z.string().min(1).optional().describe("Optional human note explaining the link."),
  projectSlug: z
    .string()
    .min(1)
    .optional()
    .describe("Defaults to the active project. Use set_active_project first if not passed."),
};

export function register(server: McpServer, client: WorkBrainClient): void {
  server.registerTool(
    "link_documents",
    {
      description:
        "Create an explicit relationship between two documents in the active project (e.g. 'TICKET-1234 depends_on TICKET-1230', 'ADR-0042 supersedes ADR-0031'). Idempotent — re-running with the same triple (from, to, linkType) returns the existing link without creating a duplicate. Cross-project links are forbidden. Use this when the relationship graph is load-bearing for future compose_context calls and the auto-linking from the classifier missed it.",
      inputSchema,
    },
    async (args) => {
      const projectSlug = args.projectSlug ?? getActiveProject();
      if (!projectSlug) {
        return toolError("No active project. Call set_active_project first or pass projectSlug.");
      }
      try {
        const result = await client.post("/api/links", { ...args, projectSlug });
        return toolJson(result);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
