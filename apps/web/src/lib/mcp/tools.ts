// Tool registry for the MCP HTTP transport.
//
// Each tool wires a Zod input schema (publish via tools/list) to a server-side
// handler that calls the underlying lib function with `userId`. Tools are
// stateless: every call must pass `projectSlug` explicitly. The "active project"
// shortcut from the stdio server is intentionally dropped here — sessions are
// per-request, so there's no good place to store it.

import { z } from "zod";
import { type ActivityRow, listActivity } from "../audit";
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
import {
  TICKET_STAGES,
  type GetTicketProgressResult,
  type SetTicketProgressResult,
  getTicketProgress,
  setTicketProgress,
} from "../ticket-progress";
import { FULL_CONTRACT } from "./instructions";

export interface ToolHandlerCtx {
  // Streamable-HTTP MCP session id, when the client supplied one. Lib calls
  // forward this into recordInvocation so the activity feed can scope to a
  // single chat. Null is fine — older clients and dev probes have none.
  sessionId: string | null;
}

export interface ToolDefinition<I, O> {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (userId: string, input: I, ctx: ToolHandlerCtx) => Promise<O>;
}

const ingestTool: ToolDefinition<z.infer<typeof IngestPasteInputSchema>, IngestPasteResult> = {
  name: "ingest_paste",
  description:
    "DIRECT-WRITE corpus tool. Most callers should use propose_document instead — that respects the user's review queue. Only use ingest_paste when the user explicitly asks to bypass the drafts pattern (e.g. 'ingest this directly without proposing'). Otherwise the corpus accumulates content the user never approved. Body is chunked, embedded with voyage-3-large, and persisted. Type is optional — omit to let Sonnet 4.6 auto-classify and extract externalId/date/references.",
  schema: IngestPasteInputSchema,
  handler: (userId, input, ctx) => ingestPaste(userId, input, { sessionId: ctx.sessionId }),
};

const proposeDocumentTool: ToolDefinition<ProposeDocumentInput, CreatedDraft> = {
  name: "propose_document",
  description:
    "MANDATORY FIRST CALL when the user message contains pasted structured content. Call this BEFORE any other tool — before Bash, Read, Grep, search, compose_context, before any analysis or recap. Detect distinct pieces in the input (separate tickets, chat threads, decisions, code blocks, transcribed screenshots) and call once per piece. NOT calling this before doing analysis is a contract violation. CRITICAL — pass `relatedExternalIds` for each piece: when multiple drafts come from the same captured input, each draft's relatedExternalIds must include the externalIds of the OTHER drafts in that batch (soft co-mention). Additionally include the externalIds of any specific tickets a draft is about (a teams_thread discussing ACME-1017 → relatedExternalIds: ['ACME-1017']; a decision for ACME-1042 → relatedExternalIds: ['ACME-1042']). Without this, with 1000 tickets the agent will never recall that these items co-occurred. After capture, acknowledge with `[Drafts queued: N (<short list>)]` and only then continue.",
  schema: ProposeDocumentInputSchema,
  handler: (userId, input, ctx) =>
    proposeDocument(userId, input, { sessionId: ctx.sessionId }),
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
  handler: (userId, input, ctx) => {
    const edits: Parameters<typeof approveDraft>[2] = {};
    if (input.type !== undefined) edits.type = input.type;
    if (input.title !== undefined) edits.title = input.title;
    if (input.content !== undefined) edits.content = input.content;
    if (input.externalId !== undefined) edits.externalId = input.externalId;
    return approveDraft(userId, input.draftId, edits, { sessionId: ctx.sessionId });
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
  handler: async (userId, input, ctx) => {
    await rejectDraft(userId, input.draftId, { sessionId: ctx.sessionId });
    return { rejected: true as const, draftId: input.draftId };
  },
};

const archiveDocumentTool: ToolDefinition<ArchiveDocumentInput, ArchiveDocumentResult> = {
  name: "archive_document",
  description:
    "Soft-delete a document from active corpus. Sets status='archived' — the document remains in the database (audit trail intact) but is excluded from search and compose_context. Pass projectSlug + externalId for normal docs (e.g. TICKET-1234) or projectSlug + documentId (uuid) when there is no external_id. ALWAYS confirm with the user listing exactly which doc(s) will be archived before calling this.",
  schema: ArchiveDocumentInputSchema,
  handler: (userId, input, ctx) =>
    archiveDocumentByRef(userId, input, { sessionId: ctx.sessionId }),
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

const SetTicketProgressInputSchema = z.object({
  projectSlug: z.string().min(1),
  externalId: z.string().min(1),
  stage: z.enum(TICKET_STAGES),
  content: z.union([z.string().min(1), z.null()]),
});

const setTicketProgressTool: ToolDefinition<
  z.infer<typeof SetTicketProgressInputSchema>,
  SetTicketProgressResult
> = {
  name: "set_ticket_progress",
  description:
    "Update one of the 5 progress stages for a ticket: analysis (optional), design, build, tests, deployment. Each stage holds free-form text (the artifact: a short approach, a list of test classes, a PR URL, etc). Pass content=null to clear a stage. ALWAYS confirm with the user in natural language before calling this — show them what will be written and to which stage. Use this proactively as work progresses: after the user articulates the design approach, call with stage='design'; after they mention a PR is open, stage='deployment'; etc. Returns the full updated progress and the next active phase.",
  schema: SetTicketProgressInputSchema,
  handler: (userId, input) =>
    setTicketProgress(userId, {
      projectSlug: input.projectSlug,
      externalId: input.externalId,
      stage: input.stage,
      content: input.content,
    }),
};

const GetTicketProgressInputSchema = z.object({
  projectSlug: z.string().min(1),
  externalId: z.string().min(1),
});

const getTicketProgressTool: ToolDefinition<
  z.infer<typeof GetTicketProgressInputSchema>,
  GetTicketProgressResult
> = {
  name: "get_ticket_progress",
  description:
    "Read the 5-stage progress of a ticket: each stage's content (or null if empty), the active phase (next empty mandatory stage), and a compact pattern like 'A·D·B·_·_'. Use this at the start of a session resuming work on a known ticket — the user should know immediately at which stage we left off.",
  schema: GetTicketProgressInputSchema,
  handler: (userId, input) =>
    getTicketProgress(userId, input.projectSlug, input.externalId),
};

const GetAgentContractInputSchema = z.object({}).optional();

const getAgentContractTool: ToolDefinition<unknown, { contract: string }> = {
  name: "get_agent_contract",
  description:
    "Returns the full WorkBrain agent contract as a markdown string: vocabulary mapping, content-shape→type mapping, drafts pattern, phase gates, repo validation, git branch prompt, inviolable rules. The summary delivered at MCP initialize is intentionally short to survive client-side truncation; call this whenever you need the full version. Always safe to call — read-only, no side effects.",
  schema: GetAgentContractInputSchema as z.ZodTypeAny,
  handler: async () => ({ contract: FULL_CONTRACT }),
};

const searchTool: ToolDefinition<SearchInput, SearchResult> = {
  name: "search",
  description:
    "Semantic search over a project's corpus. Do NOT call this until you have first called propose_document for any structured content the user pasted in their current message — capture before search. Returns top-K chunks ordered by similarity with optional Voyage rerank-2 second pass. Filter by types/externalId/dateRange. Always scoped to one projectSlug; cross-project search is not supported.",
  schema: SearchInputSchema,
  handler: (userId, input, ctx) => search(userId, input, { sessionId: ctx.sessionId }),
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
  handler: (userId, input, ctx) =>
    linkDocuments(userId, input, { sessionId: ctx.sessionId }),
};

const RecentActivityInputSchema = z.object({
  projectSlug: z.string().min(1).optional(),
  scope: z.enum(["session", "project", "user"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const recentActivityTool: ToolDefinition<
  z.infer<typeof RecentActivityInputSchema>,
  { rows: ActivityRow[]; sessionId: string | null; scope: string }
> = {
  name: "recent_activity",
  description:
    "Self-introspection: returns the last N mutations on the corpus (drafts proposed/approved/rejected, documents ingested/archived/linked, canon edits) so you can verify state without reconstructing from chat memory. Default scope is 'session' — only what THIS chat just did. Pass scope='project' (with projectSlug) to widen, or scope='user' for everything you own. ALWAYS call this before destructive operations on entities you didn't just create yourself in this session (reject_draft, archive_document) so you operate on real IDs, not assumed ones. Returns id, ts, kind, target external id, status, human description.",
  schema: RecentActivityInputSchema,
  handler: async (userId, input, ctx) => {
    const scope = input.scope ?? "session";
    let projectId: string | undefined;
    if ((scope === "project" || input.projectSlug) && input.projectSlug) {
      const { db, schema } = await import("../db");
      const { and, eq } = await import("drizzle-orm");
      const projectRows = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
        .where(
          and(
            eq(schema.clients.userId, userId),
            eq(schema.projects.slug, input.projectSlug),
          ),
        )
        .limit(1);
      projectId = projectRows[0]?.id;
    }
    const sessionId = scope === "session" ? (ctx.sessionId ?? undefined) : undefined;
    const rows = await listActivity(userId, {
      projectId,
      sessionId,
      limit: input.limit ?? 30,
    });
    return { rows, sessionId: ctx.sessionId, scope };
  },
};

const composeContextTool: ToolDefinition<
  z.infer<typeof ComposeContextInputSchema>,
  ComposeContextResult
> = {
  name: "compose_context",
  description:
    "FLAGSHIP. Assembles the structured context for working a ticket: project canon, focus document with frontmatter, linked docs grouped by type, RAG-retrieved chunks (reranked), stakeholder profiles, instructions_for_agent block. Do NOT call this until you have first called propose_document for any structured content the user pasted in their current message — capture before compose. No LLM call — pure structural composition. Provide either focusExternalId (known ticket) or focusText (free-form snippet).",
  schema: ComposeContextInputSchema,
  handler: (userId, input, ctx) => composeContext(userId, input, { sessionId: ctx.sessionId }),
};

export const TOOLS: ReadonlyArray<ToolDefinition<unknown, unknown>> = [
  getAgentContractTool,
  listProjectsTool,
  projectOverviewTool,
  proposeDocumentTool,
  listDraftsTool,
  approveDraftTool,
  rejectDraftTool,
  archiveDocumentTool,
  setTicketProgressTool,
  getTicketProgressTool,
  searchTool,
  composeContextTool,
  recordDecisionTool,
  linkDocumentsTool,
  ingestTool,
  recentActivityTool,
] as ReadonlyArray<ToolDefinition<unknown, unknown>>;

export function findTool(name: string): ToolDefinition<unknown, unknown> | undefined {
  return TOOLS.find((t) => t.name === name);
}
