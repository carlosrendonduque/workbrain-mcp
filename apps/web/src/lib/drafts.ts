import { type SQL, and, count, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { type InvocationMeta, recordInvocation } from "./audit";
import { type WorkbrainDb, schema } from "./db";
import {
  type CorpusTarget,
  type UserCorpusMap,
  type ClientScope,
  TenancyError,
  corpusMapForUser,
  fanOutCorpus,
  resolveProjectContext,
} from "./tenancy";
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

async function resolveProject(userId: string, projectSlug: string, scope: ClientScope) {
  try {
    return await resolveProjectContext(userId, projectSlug, scope);
  } catch (err) {
    if (err instanceof TenancyError) throw new DraftError(err.code, err.message, err.status);
    throw err;
  }
}

// Drafts live with the client, so every cross-project listing below asks each
// database that holds any of this user's corpus and merges the answers. The
// project ids come from the central registry, which is also what proves
// ownership now that drafts and projects cannot be joined.
async function draftScope(
  userId: string,
  scope: ClientScope,
  projectSlug?: string,
): Promise<{ map: UserCorpusMap; idsFor: (t: CorpusTarget) => string[] }> {
  const map = await corpusMapForUser(userId, scope);
  const wanted = projectSlug
    ? new Set(
        [...map.labels.values()]
          .filter((l) => l.projectSlug === projectSlug)
          .map((l) => l.projectId),
      )
    : null;
  const idsFor = (t: CorpusTarget): string[] =>
    wanted ? t.projectIds.filter((id) => wanted.has(id)) : t.projectIds;
  return { map, idsFor };
}

export interface CreatedDraft {
  draftId: string;
  projectSlug: string;
}

export async function proposeDocument(
  userId: string,
  input: ProposeDocumentInput,
  meta: InvocationMeta,
): Promise<CreatedDraft> {
  const start = Date.now();
  const project = await resolveProject(userId, input.projectSlug, meta.clientScope);

  const cleanedRelations = (input.relatedExternalIds ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => s !== input.externalId);

  const inserted = await project.corpusDb
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

  await recordInvocation({
    corpusDb: project.corpusDb,
    userId,
    projectId: project.projectId,
    operation: "propose_document",
    activityKind: "draft_proposed",
    targetExternalId: input.externalId ?? null,
    sessionId: meta.sessionId,
    status: "success",
    userPrompt: `propose_document type=${input.type} title="${input.title}" related=${cleanedRelations.length}`,
    latencyMs: Date.now() - start,
    responseText: row.id,
  });

  return { draftId: row.id, projectSlug: project.projectSlug };
}

export interface ListDraftsOpts {
  projectSlug?: string;
  status?: (typeof DRAFT_STATUS)[number];
  type?: string;
  query?: string;
  limit?: number;
}

export async function listDrafts(
  userId: string,
  scope: ClientScope,
  opts: ListDraftsOpts = {},
): Promise<DraftRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const { map, idsFor } = await draftScope(userId, scope, opts.projectSlug);

  const extra: SQL[] = [];
  if (opts.status) extra.push(eq(schema.draftDocuments.status, opts.status));
  if (opts.type) extra.push(eq(schema.draftDocuments.proposedType, opts.type));
  if (opts.query) {
    const pattern = `%${opts.query}%`;
    const queryFilter = or(
      ilike(schema.draftDocuments.proposedTitle, pattern),
      ilike(schema.draftDocuments.proposedExternalId, pattern),
      ilike(schema.draftDocuments.proposedContent, pattern),
    );
    if (queryFilter) extra.push(queryFilter);
  }

  const merged = await fanOutCorpus(map, async (t) => {
    const ids = idsFor(t);
    if (ids.length === 0) return [];
    return await t.db
      .select({
        draftId: schema.draftDocuments.id,
        projectId: schema.draftDocuments.projectId,
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
      .where(and(inArray(schema.draftDocuments.projectId, ids), ...extra))
      .orderBy(desc(schema.draftDocuments.createdAt))
      .limit(limit);
  });

  return merged
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .map((r) => {
      const label = map.labels.get(r.projectId);
      return {
        ...r,
        projectSlug: label?.projectSlug ?? "",
        projectName: label?.projectName ?? "",
        clientSlug: label?.clientSlug ?? "",
        status: r.status as (typeof DRAFT_STATUS)[number],
        relatedExternalIds: normalizeStringArray(r.relatedExternalIds),
      };
    });
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

export interface DraftTypeCount {
  type: string;
  count: number;
}

export interface DraftTypeCountsOpts {
  projectSlug?: string;
  status?: (typeof DRAFT_STATUS)[number];
}

export async function getDraftTypeCounts(
  userId: string,
  scope: ClientScope,
  opts: DraftTypeCountsOpts = {},
): Promise<DraftTypeCount[]> {
  const { map, idsFor } = await draftScope(userId, scope, opts.projectSlug);
  const extra = opts.status ? [eq(schema.draftDocuments.status, opts.status)] : [];

  const rows = await fanOutCorpus(map, async (t) => {
    const ids = idsFor(t);
    if (ids.length === 0) return [];
    return await t.db
      .select({ type: schema.draftDocuments.proposedType, count: sql<number>`count(*)::int` })
      .from(schema.draftDocuments)
      .where(and(inArray(schema.draftDocuments.projectId, ids), ...extra))
      .groupBy(schema.draftDocuments.proposedType);
  });

  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.type, (totals.get(r.type) ?? 0) + r.count);
  return [...totals.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

export async function countPendingDraftsForUser(
  userId: string,
  scope: ClientScope,
): Promise<number> {
  const { map, idsFor } = await draftScope(userId, scope);
  const rows = await fanOutCorpus(map, async (t) => {
    const ids = idsFor(t);
    if (ids.length === 0) return [];
    return await t.db
      .select({ n: count(schema.draftDocuments.id) })
      .from(schema.draftDocuments)
      .where(
        and(
          inArray(schema.draftDocuments.projectId, ids),
          eq(schema.draftDocuments.status, "pending"),
        ),
      );
  });
  return rows.reduce((acc, r) => acc + (r.n ?? 0), 0);
}

export async function countPendingDraftsByProject(
  userId: string,
  scope: ClientScope,
): Promise<Map<string, number>> {
  const { map, idsFor } = await draftScope(userId, scope);
  const rows = await fanOutCorpus(map, async (t) => {
    const ids = idsFor(t);
    if (ids.length === 0) return [];
    return await t.db
      .select({ projectId: schema.draftDocuments.projectId, n: count(schema.draftDocuments.id) })
      .from(schema.draftDocuments)
      .where(
        and(
          inArray(schema.draftDocuments.projectId, ids),
          eq(schema.draftDocuments.status, "pending"),
        ),
      )
      .groupBy(schema.draftDocuments.projectId);
  });
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.projectId, (m.get(r.projectId) ?? 0) + r.n);
  return m;
}

// A bare draft id no longer says which database holds it, so ask each one,
// scoped to the projects that live there — that scoping is what proves the
// draft belongs to this user. Returns the handle it was found in so the
// caller writes back to the same place.
async function ownedDraft(userId: string, draftId: string, scope: ClientScope) {
  const map = await corpusMapForUser(userId, scope);

  for (const target of map.targets) {
    if (target.projectIds.length === 0) continue;
    const rows = await target.db
      .select({
        draftId: schema.draftDocuments.id,
        projectId: schema.draftDocuments.projectId,
        proposedType: schema.draftDocuments.proposedType,
        proposedTitle: schema.draftDocuments.proposedTitle,
        proposedContent: schema.draftDocuments.proposedContent,
        proposedExternalId: schema.draftDocuments.proposedExternalId,
        proposedFrontmatter: schema.draftDocuments.proposedFrontmatter,
        relatedExternalIds: schema.draftDocuments.relatedExternalIds,
        status: schema.draftDocuments.status,
      })
      .from(schema.draftDocuments)
      .where(
        and(
          eq(schema.draftDocuments.id, draftId),
          inArray(schema.draftDocuments.projectId, target.projectIds),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row) {
      const label = map.labels.get(row.projectId);
      return {
        ...row,
        projectSlug: label?.projectSlug ?? "",
        corpusDb: target.db as WorkbrainDb,
      };
    }
  }

  throw new DraftError("draft_not_found", `Draft ${draftId} not found.`, 404);
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
  meta: InvocationMeta,
): Promise<ApproveDraftResult> {
  const start = Date.now();
  const draft = await ownedDraft(userId, draftId, meta.clientScope);
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

  const ingested = await ingestPaste(
    userId,
    {
      projectSlug: draft.projectSlug,
      type: finalType,
      title: finalTitle,
      content: finalContent,
      externalId: finalExternalId,
    },
    meta,
  );

  await draft.corpusDb
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
    draft.corpusDb,
    draft.projectId,
    ingested.documentId,
    normalizeStringArray(draft.relatedExternalIds),
  );

  await recordInvocation({
    corpusDb: draft.corpusDb,
    userId,
    projectId: draft.projectId,
    operation: "approve_draft",
    activityKind: "draft_approved",
    targetExternalId: finalExternalId ?? null,
    sessionId: meta.sessionId,
    status: "success",
    userPrompt: `approve_draft ${draftId} type=${finalType} title="${finalTitle}"`,
    latencyMs: Date.now() - start,
    responseText: ingested.documentId,
  });

  return { draftId, ingested };
}

async function materializeRelations(
  corpusDb: WorkbrainDb,
  projectId: string,
  fromDocumentId: string,
  relatedExternalIds: string[],
): Promise<void> {
  const ids = relatedExternalIds.filter((s) => s.length > 0);
  if (ids.length === 0) return;

  const matches = await corpusDb
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
  const existing = await corpusDb
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
    await corpusDb.insert(schema.documentLinks).values(toInsert);
  }
}

export async function rejectDraft(
  userId: string,
  draftId: string,
  meta: InvocationMeta,
): Promise<void> {
  const start = Date.now();
  const draft = await ownedDraft(userId, draftId, meta.clientScope);
  if (draft.status !== "pending") {
    throw new DraftError(
      "not_pending",
      `Draft ${draftId} is ${draft.status}; only pending drafts can be rejected.`,
      409,
    );
  }
  await draft.corpusDb
    .update(schema.draftDocuments)
    .set({ status: "rejected", reviewedAt: sql`now()` })
    .where(eq(schema.draftDocuments.id, draftId));

  await recordInvocation({
    corpusDb: draft.corpusDb,
    userId,
    projectId: draft.projectId,
    operation: "reject_draft",
    activityKind: "draft_rejected",
    targetExternalId: draft.proposedExternalId ?? null,
    sessionId: meta.sessionId,
    status: "success",
    userPrompt: `reject_draft ${draftId} type=${draft.proposedType} title="${draft.proposedTitle}"`,
    latencyMs: Date.now() - start,
  });
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
  scope: ClientScope,
): Promise<void> {
  const draft = await ownedDraft(userId, draftId, scope);
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

  await draft.corpusDb
    .update(schema.draftDocuments)
    .set(updates)
    .where(eq(schema.draftDocuments.id, draftId));
}
