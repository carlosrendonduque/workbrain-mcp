// Tool registry for the MCP HTTP transport.
//
// Each tool wires a Zod input schema (publish via tools/list) to a server-side
// handler that calls the underlying lib function with `userId`. Tools are
// stateless: every call must pass `projectSlug` explicitly. The "active project"
// shortcut from the stdio server is intentionally dropped here — sessions are
// per-request, so there's no good place to store it.

import { z } from "zod";
import { type ComposeContextResult, ComposeContextInputSchema, composeContext } from "../compose";
import { type RecordDecisionInput, RecordDecisionInputSchema, recordDecision } from "../decisions";
import {
  type IngestPasteResult,
  IngestPasteInputSchema,
  ingestPaste,
} from "../paste";
import { type LinkDocumentsInput, LinkDocumentsInputSchema, linkDocuments } from "../links";
import { type SearchInput, SearchInputSchema, type SearchResult, search } from "../search";

export interface ToolDefinition<I, O> {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (userId: string, input: I) => Promise<O>;
}

const ingestTool: ToolDefinition<z.infer<typeof IngestPasteInputSchema>, IngestPasteResult> = {
  name: "ingest_paste",
  description:
    "Ingest a pasted document (ticket, email, decision, transcript, note, etc.) into the corpus. The body is chunked, embedded with voyage-3-large, and persisted to the database. Type is optional — omit it to let the backend auto-classify with Sonnet 4.6 and extract externalId/date/references from the body. References that match other documents in the same project become auto-links.",
  schema: IngestPasteInputSchema,
  handler: (userId, input) => ingestPaste(userId, input),
};

const searchTool: ToolDefinition<SearchInput, SearchResult> = {
  name: "search",
  description:
    "Semantic search over a project's corpus. Returns the top-K chunks ordered by similarity, with optional Voyage rerank-2 second pass. Filter by document types, externalId, or createdAt date range. Always scope to one projectSlug — cross-project search is not supported by design.",
  schema: SearchInputSchema,
  handler: (userId, input) => search(userId, input),
};

const recordDecisionTool: ToolDefinition<RecordDecisionInput, IngestPasteResult> = {
  name: "record_decision",
  description:
    "Capture a project decision (an ADR-style statement of why we chose X) into the corpus as a `decision` document. Behaves like ingest_paste with type=decision pre-set; provide title and rationale body. Useful when the agent and user agreed on something the corpus should remember.",
  schema: RecordDecisionInputSchema,
  handler: (userId, input) => recordDecision(userId, input),
};

const linkDocumentsTool: ToolDefinition<LinkDocumentsInput, unknown> = {
  name: "link_documents",
  description:
    "Create an explicit relationship between two documents in the same project (e.g. TICKET-9001 supersedes ADR-0042, or TICKET-9001 depends_on TICKET-8870). Idempotent — re-running with the same triple (from, to, linkType) returns the existing link. Cross-project links are forbidden.",
  schema: LinkDocumentsInputSchema,
  handler: (userId, input) => linkDocuments(userId, input),
};

const composeContextTool: ToolDefinition<
  z.infer<typeof ComposeContextInputSchema>,
  ComposeContextResult
> = {
  name: "compose_context",
  description:
    "FLAGSHIP. Assemble the structured context an IDE coding agent needs to work a ticket: project canon (conventions, guidelines, architecture), focus document with frontmatter, linked documents grouped by type, RAG-retrieved chunks (reranked when possible), stakeholder profiles, and a pre-formatted instructions_for_agent block. No LLM call — pure structural composition. Provide either focusExternalId (working a known ticket) or focusText (free-form question or code snippet).",
  schema: ComposeContextInputSchema,
  handler: (userId, input) => composeContext(userId, input),
};

export const TOOLS: ReadonlyArray<ToolDefinition<unknown, unknown>> = [
  ingestTool,
  searchTool,
  recordDecisionTool,
  linkDocumentsTool,
  composeContextTool,
] as ReadonlyArray<ToolDefinition<unknown, unknown>>;

export function findTool(name: string): ToolDefinition<unknown, unknown> | undefined {
  return TOOLS.find((t) => t.name === name);
}
