// Tool registry for the MCP HTTP transport.
//
// Each tool wires a Zod input schema (publish via tools/list) to a server-side
// handler that calls the underlying lib function with `userId`. Tools are
// stateless: every call must pass `projectSlug` explicitly. The "active project"
// shortcut from the stdio server is intentionally dropped here — sessions are
// per-request, so there's no good place to store it.

import { z } from "zod";
import { type ComposeContextResult, ComposeContextInputSchema, composeContext } from "../compose";
import {
  type ArchiveDocumentInput,
  type ArchiveDocumentResult,
  ArchiveDocumentInputSchema,
  archiveDocumentByRef,
} from "../curation";
import { type RecordDecisionInput, RecordDecisionInputSchema, recordDecision } from "../decisions";
import {
  type ApproveDraftResult,
  type CreatedDraft,
  type DraftRow,
  type ProposeDocumentInput,
  ProposeDocumentInputSchema,
  approveDraft,
  listDrafts,
  proposeDocument,
  rejectDraft,
} from "../drafts";
import {
  type IngestPasteResult,
  IngestPasteInputSchema,
  ingestPaste,
} from "../paste";
import { type LinkDocumentsInput, LinkDocumentsInputSchema, linkDocuments } from "../links";
import { type ProjectOverview, getProjectOverview } from "../projects";
import { type SearchInput, SearchInputSchema, type SearchResult, search } from "../search";
import { type ProjectRow, getProjectsForUser } from "../stats";

export interface ToolDefinition<I, O> {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (userId: string, input: I) => Promise<O>;
}

const ingestTool: ToolDefinition<z.infer<typeof IngestPasteInputSchema>, IngestPasteResult> = {
  name: "ingest_paste",
  description:
    "DIRECT-WRITE corpus tool. Most callers should use propose_document instead — that respects the user's review queue. Only use ingest_paste when the user explicitly asks to bypass the drafts pattern (e.g. 'ingest this directly without proposing'). Otherwise the corpus accumulates content the user never approved. Body is chunked, embedded with voyage-3-large, and persisted. Type is optional — omit to let Sonnet 4.6 auto-classify and extract externalId/date/references.",
  schema: IngestPasteInputSchema,
  handler: (userId, input) => ingestPaste(userId, input),
};

const proposeDocumentTool: ToolDefinition<ProposeDocumentInput, CreatedDraft> = {
  name: "propose_document",
  description:
    "PREFERRED capture path. Creates a DRAFT — the document does NOT enter the corpus until the user approves it. Use this proactively when you detect curation-worthy content during a conversation: pasted tickets, design decisions the user articulated, non-obvious explanations, screenshots transcribed to markdown, etc. Tell the user casually that you added a draft (e.g. '[Draft added: title]') so they know it's queued. Drafts persist across sessions and are reviewed at /projects/<client>/<project>/drafts. The user approves with approve_draft (which then runs the actual ingest_paste), edits with the same tool, or discards with reject_draft.",
  schema: ProposeDocumentInputSchema,
  handler: (userId, input) => proposeDocument(userId, input),
};

const ListDraftsInputSchema = z.object({
  projectSlug: z.string().min(1).optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const listDraftsTool: ToolDefinition<z.infer<typeof ListDraftsInputSchema>, DraftRow[]> = {
  name: "list_drafts",
  description:
    "List drafts for the active user. Defaults to all projects + all statuses. Pass projectSlug to scope to one project. Pass status='pending' to show only what's waiting for review (the most common case). Use this when the user asks 'qué tengo en draft', 'muéstrame los drafts pendientes', or before suggesting a batch approval.",
  schema: ListDraftsInputSchema,
  handler: (userId, input) => listDrafts(userId, input),
};

const ApproveDraftInputSchema = z.object({
  draftId: z.string().uuid(),
  type: z
    .enum([
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
    ])
    .optional(),
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  externalId: z.union([z.string().min(1), z.null()]).optional(),
});

const approveDraftTool: ToolDefinition<z.infer<typeof ApproveDraftInputSchema>, ApproveDraftResult> = {
  name: "approve_draft",
  description:
    "Promote a pending draft into the corpus. This calls ingest_paste under the hood with the draft's content (or your edits, if any of type/title/content/externalId are passed in). Auto-links references, audits the action, and links the draft row to the new document. ALWAYS confirm with the user before calling this — show them the exact title/type/externalId that will land. Idempotent on already-approved drafts will fail; re-confirm if status is unclear by calling list_drafts first.",
  schema: ApproveDraftInputSchema,
  handler: (userId, input) => {
    const edits: Parameters<typeof approveDraft>[2] = {};
    if (input.type !== undefined) edits.type = input.type;
    if (input.title !== undefined) edits.title = input.title;
    if (input.content !== undefined) edits.content = input.content;
    if (input.externalId !== undefined) edits.externalId = input.externalId;
    return approveDraft(userId, input.draftId, edits);
  },
};

const RejectDraftInputSchema = z.object({
  draftId: z.string().uuid(),
});

const rejectDraftTool: ToolDefinition<z.infer<typeof RejectDraftInputSchema>, { rejected: true; draftId: string }> = {
  name: "reject_draft",
  description:
    "Discard a pending draft. The row stays in the database with status='rejected' (audit trail of what was proposed and not kept), but it never enters the corpus. Use when the user says 'no, descartá ese' or similar after reviewing a proposal.",
  schema: RejectDraftInputSchema,
  handler: async (userId, input) => {
    await rejectDraft(userId, input.draftId);
    return { rejected: true as const, draftId: input.draftId };
  },
};

const archiveDocumentTool: ToolDefinition<ArchiveDocumentInput, ArchiveDocumentResult> = {
  name: "archive_document",
  description:
    "Soft-delete a document from active corpus. Sets status='archived' — the document remains in the database (audit trail intact) but is excluded from search and compose_context. Pass projectSlug + externalId for normal docs (e.g. TICKET-1234) or projectSlug + documentId (uuid) when there is no external_id. ALWAYS confirm with the user listing exactly which doc(s) will be archived before calling this.",
  schema: ArchiveDocumentInputSchema,
  handler: (userId, input) => archiveDocumentByRef(userId, input),
};

const ListProjectsInputSchema = z.object({}).optional();

const listProjectsTool: ToolDefinition<unknown, ProjectRow[]> = {
  name: "list_projects",
  description:
    "List all projects the active user owns, with client name, slug, doc/chunk counts, persistence flag and last-invocation timestamp. Use this when the user opens a fresh chat and you don't yet know which project they want to work on — present the list as a numbered menu and ask them to pick. Also use when the user asks 'qué proyectos tengo' or similar discovery questions.",
  schema: ListProjectsInputSchema as z.ZodTypeAny,
  handler: (userId) => getProjectsForUser(userId),
};

const ProjectOverviewInputSchema = z.object({
  projectSlug: z.string().min(1),
});

const projectOverviewTool: ToolDefinition<z.infer<typeof ProjectOverviewInputSchema>, ProjectOverview | null> = {
  name: "project_overview",
  description:
    "Get a brief snapshot of a project: client + project name, canon flags (which sections have content), doc count by type, stakeholder count, pending drafts count, last 5 documents, last invocation timestamp. Use this RIGHT AFTER the user picks a project (from list_projects menu or by mentioning one) so they get context-on-arrival before starting real work. Keep the response short — 5-8 lines max.",
  schema: ProjectOverviewInputSchema,
  handler: (userId, input) => getProjectOverview(userId, input.projectSlug),
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
  listProjectsTool,
  projectOverviewTool,
  proposeDocumentTool,
  listDraftsTool,
  approveDraftTool,
  rejectDraftTool,
  archiveDocumentTool,
  searchTool,
  composeContextTool,
  recordDecisionTool,
  linkDocumentsTool,
  ingestTool,
] as ReadonlyArray<ToolDefinition<unknown, unknown>>;

export function findTool(name: string): ToolDefinition<unknown, unknown> | undefined {
  return TOOLS.find((t) => t.name === name);
}
