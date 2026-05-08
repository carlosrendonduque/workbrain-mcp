import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db";
import { type IngestPasteResult, ingestPaste } from "./paste";

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

const DRAFT_STATUS = ["pending", "approved", "rejected"] as const;

export class DraftError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "DraftError";
    this.code = code;
    this.status = status;
  }
}

export const ProposeDocumentInputSchema = z.object({
  projectSlug: z.string().min(1),
  type: z.enum(DOCUMENT_TYPES),
  title: z.string().min(1),
  content: z.string().min(1),
  externalId: z.string().min(1).optional(),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
  proposalNote: z.string().min(1).optional(),
  // External IDs of other documents (real or other drafts) related to this
  // one. On approve, each becomes a `related` document_links row when the
  // other side already exists as a real document. Use for co-mention
  // ('these tickets came from the same conversation'), or for semantic
  // grouping ('this teams_thread discusses ACME-1017', 'this decision
  // applies to ACME-1042'). For STRONG semantic relationships
  // (depends_on, supersedes), use link_documents directly after approval.
  relatedExternalIds: z.array(z.string().min(1)).optional(),
});

export type ProposeDocumentInput = z.infer<typeof ProposeDocumentInputSchema>;

export interface DraftRow {
  draftId: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  clientSlug: string;
  proposedType: string;
  proposedTitle: string;
  proposedContent: string;
  proposedExternalId: string | null;
  proposedFrontmatter: unknown;
  proposalNote: string | null;
  relatedExternalIds: string[];
  status: (typeof DRAFT_STATUS)[number];
  proposedBy: string;
  approvedDocumentId: string | null;
  createdAt: Date | string;
  reviewedAt: Date | string | null;
}

interface ResolvedProject {
  projectId: string;
  projectSlug: string;
  clientSlug: string;
}

async function resolveProject(userId: string, projectSlug: string): Promise<ResolvedProject> {
  const rows = await db
    .select({
      projectId: schema.projects.id,
      projectSlug: schema.projects.slug,
      clientSlug: schema.clients.slug,
    })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(and(eq(schema.clients.userId, userId), eq(schema.projects.slug, projectSlug)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new DraftError(
      "project_not_found",
      `Project ${projectSlug} not found for active user.`,
      404,
    );
  }
  return row;
}

export interface CreatedDraft {
  draftId: string;
  projectSlug: string;
}

export async function proposeDocument(
  userId: string,
  input: ProposeDocumentInput,
): Promise<CreatedDraft> {
  const project = await resolveProject(userId, input.projectSlug);

  const cleanedRelations = (input.relatedExternalIds ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => s !== input.externalId);

  const inserted = await db
    .insert(schema.draftDocuments)
    .values({
      projectId: project.projectId,
      proposedType: input.type,
      proposedTitle: input.title,
      proposedContent: input.content,
      proposedExternalId: input.externalId ?? null,
      proposedFrontmatter: input.frontmatter ?? {},
      proposalNote: input.proposalNote ?? null,
      relatedExternalIds: cleanedRelations,
      status: "pending",
      proposedBy: "agent",
    })
    .returning({ id: schema.draftDocuments.id });

  const row = inserted[0];
  if (!row) {
    throw new DraftError("insert_failed", "Failed to insert draft.", 500);
  }
  return { draftId: row.id, projectSlug: project.projectSlug };
}

export interface ListDraftsOpts {
  projectSlug?: string;
  status?: (typeof DRAFT_STATUS)[number];
  limit?: number;
}

export async function listDrafts(userId: string, opts: ListDraftsOpts = {}): Promise<DraftRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);

  const filters = [eq(schema.clients.userId, userId)];
  if (opts.projectSlug) filters.push(eq(schema.projects.slug, opts.projectSlug));
  if (opts.status) filters.push(eq(schema.draftDocuments.status, opts.status));

  const rows = await db
    .select({
      draftId: schema.draftDocuments.id,
      projectId: schema.draftDocuments.projectId,
      projectSlug: schema.projects.slug,
      projectName: schema.projects.name,
      clientSlug: schema.clients.slug,
      proposedType: schema.draftDocuments.proposedType,
      proposedTitle: schema.draftDocuments.proposedTitle,
      proposedContent: schema.draftDocuments.proposedContent,
      proposedExternalId: schema.draftDocuments.proposedExternalId,
      proposedFrontmatter: schema.draftDocuments.proposedFrontmatter,
      proposalNote: schema.draftDocuments.proposalNote,
      relatedExternalIds: schema.draftDocuments.relatedExternalIds,
      status: schema.draftDocuments.status,
      proposedBy: schema.draftDocuments.proposedBy,
      approvedDocumentId: schema.draftDocuments.approvedDocumentId,
      createdAt: schema.draftDocuments.createdAt,
      reviewedAt: schema.draftDocuments.reviewedAt,
    })
    .from(schema.draftDocuments)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.draftDocuments.projectId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(and(...filters))
    .orderBy(desc(schema.draftDocuments.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    status: r.status as (typeof DRAFT_STATUS)[number],
    relatedExternalIds: normalizeStringArray(r.relatedExternalIds),
  }));
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

export async function countPendingDraftsForUser(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count(schema.draftDocuments.id) })
    .from(schema.draftDocuments)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.draftDocuments.projectId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(
      and(eq(schema.clients.userId, userId), eq(schema.draftDocuments.status, "pending")),
    );
  return row?.n ?? 0;
}

export async function countPendingDraftsByProject(
  userId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      projectId: schema.draftDocuments.projectId,
      n: count(schema.draftDocuments.id),
    })
    .from(schema.draftDocuments)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.draftDocuments.projectId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(
      and(eq(schema.clients.userId, userId), eq(schema.draftDocuments.status, "pending")),
    )
    .groupBy(schema.draftDocuments.projectId);
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.projectId, r.n);
  return m;
}

async function ownedDraft(userId: string, draftId: string) {
  const rows = await db
    .select({
      draftId: schema.draftDocuments.id,
      projectId: schema.draftDocuments.projectId,
      projectSlug: schema.projects.slug,
      proposedType: schema.draftDocuments.proposedType,
      proposedTitle: schema.draftDocuments.proposedTitle,
      proposedContent: schema.draftDocuments.proposedContent,
      proposedExternalId: schema.draftDocuments.proposedExternalId,
      proposedFrontmatter: schema.draftDocuments.proposedFrontmatter,
      relatedExternalIds: schema.draftDocuments.relatedExternalIds,
      status: schema.draftDocuments.status,
    })
    .from(schema.draftDocuments)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.draftDocuments.projectId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(
      and(eq(schema.clients.userId, userId), eq(schema.draftDocuments.id, draftId)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new DraftError("draft_not_found", `Draft ${draftId} not found.`, 404);
  }
  return row;
}

export interface ApproveDraftEdits {
  type?: ProposeDocumentInput["type"];
  title?: string;
  content?: string;
  externalId?: string | null;
}

export interface ApproveDraftResult {
  draftId: string;
  ingested: IngestPasteResult;
}

// Approving a draft = ingest_paste with the proposed (or edited) values, then
// flip the draft to status=approved with a pointer to the new document.
export async function approveDraft(
  userId: string,
  draftId: string,
  edits: ApproveDraftEdits = {},
): Promise<ApproveDraftResult> {
  const draft = await ownedDraft(userId, draftId);
  if (draft.status !== "pending") {
    throw new DraftError(
      "not_pending",
      `Draft ${draftId} is ${draft.status}; only pending drafts can be approved.`,
      409,
    );
  }

  const finalType = edits.type ?? (draft.proposedType as ProposeDocumentInput["type"]);
  const finalTitle = edits.title ?? draft.proposedTitle;
  const finalContent = edits.content ?? draft.proposedContent;
  const finalExternalId =
    edits.externalId === null
      ? undefined
      : (edits.externalId ?? draft.proposedExternalId ?? undefined);

  const ingested = await ingestPaste(userId, {
    projectSlug: draft.projectSlug,
    type: finalType,
    title: finalTitle,
    content: finalContent,
    externalId: finalExternalId,
  });

  await db
    .update(schema.draftDocuments)
    .set({
      status: "approved",
      reviewedAt: sql`now()`,
      approvedDocumentId: ingested.documentId,
      // Persist the edits the user actually approved (audit-friendly).
      proposedType: finalType,
      proposedTitle: finalTitle,
      proposedContent: finalContent,
      proposedExternalId: finalExternalId ?? null,
    })
    .where(eq(schema.draftDocuments.id, draftId));

  // Convert the draft's relatedExternalIds into `related` document_links.
  // For each related external_id, link only when a real document with that
  // id exists in the same project — otherwise skip silently. The reverse
  // link will be created when the OTHER draft is approved (its relations
  // include this one's id).
  await materializeRelations(
    draft.projectId,
    ingested.documentId,
    normalizeStringArray(draft.relatedExternalIds),
  );

  return { draftId, ingested };
}

async function materializeRelations(
  projectId: string,
  fromDocumentId: string,
  relatedExternalIds: string[],
): Promise<void> {
  const ids = relatedExternalIds.filter((s) => s.length > 0);
  if (ids.length === 0) return;

  const matches = await db
    .select({
      id: schema.documents.id,
      externalId: schema.documents.externalId,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.projectId, projectId),
        inArray(schema.documents.externalId, ids),
        ne(schema.documents.id, fromDocumentId),
      ),
    );

  if (matches.length === 0) return;

  // Avoid creating duplicate (from,to,related) links if user has approved
  // both ends already. Read existing forward AND backward edges first.
  const targetIds = matches.map((m) => m.id);
  const existing = await db
    .select({
      from: schema.documentLinks.fromDocumentId,
      to: schema.documentLinks.toDocumentId,
    })
    .from(schema.documentLinks)
    .where(
      and(
        eq(schema.documentLinks.linkType, "related"),
        inArray(schema.documentLinks.fromDocumentId, [fromDocumentId, ...targetIds]),
      ),
    );

  const existingPairs = new Set<string>();
  for (const e of existing) {
    existingPairs.add(`${e.from}|${e.to}`);
    existingPairs.add(`${e.to}|${e.from}`);
  }

  const toInsert = matches
    .filter((m) => !existingPairs.has(`${fromDocumentId}|${m.id}`))
    .map((m) => ({
      fromDocumentId,
      toDocumentId: m.id,
      linkType: "related",
      note: "co-captured in same proposal",
    }));

  if (toInsert.length > 0) {
    await db.insert(schema.documentLinks).values(toInsert);
  }
}

export async function rejectDraft(userId: string, draftId: string): Promise<void> {
  const draft = await ownedDraft(userId, draftId);
  if (draft.status !== "pending") {
    throw new DraftError(
      "not_pending",
      `Draft ${draftId} is ${draft.status}; only pending drafts can be rejected.`,
      409,
    );
  }
  await db
    .update(schema.draftDocuments)
    .set({ status: "rejected", reviewedAt: sql`now()` })
    .where(eq(schema.draftDocuments.id, draftId));
}

export interface EditDraftInput {
  type?: ProposeDocumentInput["type"];
  title?: string;
  content?: string;
  externalId?: string | null;
  proposalNote?: string | null;
}

export async function editDraft(
  userId: string,
  draftId: string,
  edits: EditDraftInput,
): Promise<void> {
  const draft = await ownedDraft(userId, draftId);
  if (draft.status !== "pending") {
    throw new DraftError(
      "not_pending",
      `Draft ${draftId} is ${draft.status}; only pending drafts can be edited.`,
      409,
    );
  }

  const updates: Partial<{
    proposedType: string;
    proposedTitle: string;
    proposedContent: string;
    proposedExternalId: string | null;
    proposalNote: string | null;
  }> = {};
  if (edits.type !== undefined) updates.proposedType = edits.type;
  if (edits.title !== undefined) updates.proposedTitle = edits.title;
  if (edits.content !== undefined) updates.proposedContent = edits.content;
  if (edits.externalId !== undefined) updates.proposedExternalId = edits.externalId;
  if (edits.proposalNote !== undefined) updates.proposalNote = edits.proposalNote;

  if (Object.keys(updates).length === 0) return;

  await db
    .update(schema.draftDocuments)
    .set(updates)
    .where(eq(schema.draftDocuments.id, draftId));
}
