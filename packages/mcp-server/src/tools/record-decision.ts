import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkBrainClient } from "../client.js";
import { toolError, toolJson } from "./helpers.js";
import { getActiveProject } from "../state.js";

const inputSchema = {
  title: z
    .string()
    .min(1)
    .describe("Short title for the decision (e.g. 'Use pgvector for corpus')."),
  body: z
    .string()
    .min(1)
    .describe(
      "Markdown body of the decision. Typical ADR shape: Status / Context / Decision / Consequences.",
    ),
  linksTo: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "External IDs of related documents (e.g. ['TICKET-1234', 'ADR-0017']). Each match in the same project becomes an auto-link in document_links.",
    ),
  tags: z.array(z.string()).optional(),
  projectSlug: z
    .string()
    .min(1)
    .optional()
    .describe("Defaults to the active project. Use set_active_project first if not passed."),
};

export function register(server: McpServer, client: WorkBrainClient): void {
  server.registerTool(
    "record_decision",
    {
      description:
        "Record a technical decision or ADR for the active project. Persists as a 'decision'-type document (chunked, embedded, written to disk + database, pushed to the corpus repo) and auto-links to any external IDs in linksTo. Use this when closing a ticket with a decision, capturing an architectural choice, or noting why an alternative was discarded — the decision will surface in future search and compose_context calls.",
      inputSchema,
    },
    async (args) => {
      const projectSlug = args.projectSlug ?? getActiveProject();
      if (!projectSlug) {
        return toolError("No active project. Call set_active_project first or pass projectSlug.");
      }
      try {
        const result = await client.post("/api/decisions", { ...args, projectSlug });
        return toolJson(result);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
