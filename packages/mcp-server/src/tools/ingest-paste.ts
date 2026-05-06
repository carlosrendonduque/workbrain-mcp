import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkBrainClient } from "../client.js";
import { toolError, toolJson } from "./helpers.js";
import { getActiveProject } from "../state.js";

const DOCUMENT_TYPES = [
  "ticket",
  "confluence",
  "teams_thread",
  "email",
  "transcript",
  "decision",
  "convention",
  "guideline",
  "stakeholder",
  "task",
  "note",
] as const;

const inputSchema = {
  type: z
    .enum(DOCUMENT_TYPES)
    .optional()
    .describe(
      "Document type. Optional — if omitted, the backend auto-classifies the body via Claude Sonnet 4.6 and infers the type, externalId, and primary date.",
    ),
  title: z.string().min(1).describe("Document title."),
  content: z.string().min(1).describe("Raw markdown body of the document."),
  externalId: z.string().min(1).optional().describe("External identifier, e.g. TICKET-1234."),
  status: z.enum(["open", "in_progress", "resolved"]).optional(),
  tags: z.array(z.string()).optional(),
  relatedTickets: z.array(z.string()).optional(),
  projectSlug: z
    .string()
    .min(1)
    .optional()
    .describe("Defaults to the active project. Use set_active_project first if not passed."),
};

export function register(server: McpServer, client: WorkBrainClient): void {
  server.registerTool(
    "ingest_paste",
    {
      description:
        "Ingest a pasted document into the active project's corpus. The body is chunked, embedded with voyage-3-large, persisted to disk plus database, and pushed to the corpus git repo. Type is optional — omit it to let the backend auto-classify (ticket, Confluence page, Teams thread, email, transcript, decision, convention, guideline, stakeholder, task, note) and extract externalId/date from the body. Pass type explicitly when you already know it to skip the classifier call.",
      inputSchema,
    },
    async (args) => {
      const projectSlug = args.projectSlug ?? getActiveProject();
      if (!projectSlug) {
        return toolError(
          "No active project. Call set_active_project first or pass projectSlug explicitly.",
        );
      }
      try {
        const result = await client.post("/api/ingest/paste", { ...args, projectSlug });
        return toolJson(result);
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
