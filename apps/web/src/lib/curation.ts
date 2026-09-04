import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { type InvocationMeta, recordInvocation } from "./audit";
import { type WorkbrainDb, schema } from "./db";
import { TenancyError, corpusMapForUser, resolveProjectContext } from "./tenancy";

export class CurationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "CurationError";
    this.code = code;
    this.status = status;
  }
}

export const ARCHIVED_STATUS = "archived";

interface OwnedDocument {
  documentId: string;
  projectId: string;
  currentStatus: string | null;
  /** The database the document was found in — subsequent writes must use it. */
  corpusDb: WorkbrainDb;
}

/**
 * Find a document by id alone, when the caller has no project in hand (the
 * webapp's archive buttons work this way).
 *
 * A bare document id no longer says which database holds it, so this asks
 * each database that holds any of the user's corpus, scoped to the projects
 * that live there. That scoping is what proves ownership now that documents
 * and projects can no longer be joined.
 */
async function resolveOwnedDocument(userId: string, documentId: string): Promise<OwnedDocument> {
  const map = await corpusMapForUser(userId);

  for (const target of map.targets) {
    if (target.projectIds.length === 0) continue;
    const rows = await target.db
      .select({
        documentId: schema.documents.id,
        projectId: schema.documents.projectId,
        currentStatus: schema.documents.status,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, documentId),
          inArray(schema.documents.projectId, target.projectIds),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row) return { ...row, corpusDb: target.db };
  }

  throw new CurationError("document_not_found", `Document ${documentId} not found`, 404);
}

export async function archiveDocument(userId: string, documentId: string): Promise<void> {
  const owned = await resolveOwnedDocument(userId, documentId);
  await owned.corpusDb
    .update(schema.documents)
    .set({ status: ARCHIVED_STATUS, updatedAt: sql`now()` })
    .where(eq(schema.documents.id, documentId));
}

export async function unarchiveDocument(userId: string, documentId: string): Promise<void> {
  const owned = await resolveOwnedDocument(userId, documentId);
  await owned.corpusDb
    .update(schema.documents)
    .set({ status: null, updatedAt: sql`now()` })
    .where(eq(schema.documents.id, documentId));
}

// Tool-friendly variant: lookup by externalId within a project, or by uuid.
// Used by the MCP archive_document tool so callers don't need internal ids.
export const ArchiveDocumentInputSchema = z
  .object({
    projectSlug: z.string().min(1),
    externalId: z.string().min(1).optional(),
    documentId: z.string().uuid().optional(),
  })
  .refine((d) => Boolean(d.externalId) !== Boolean(d.documentId), {
    message: "Provide exactly one of externalId or documentId.",
  });

export type ArchiveDocumentInput = z.infer<typeof ArchiveDocumentInputSchema>;

export interface ArchiveDocumentResult {
  documentId: string;
  externalId: string | null;
  title: string;
  archivedFrom: string | null;
}

export async function archiveDocumentByRef(
  userId: string,
  input: ArchiveDocumentInput,
  meta: InvocationMeta = {},
): Promise<ArchiveDocumentResult> {
  const start = Date.now();

  // Resolving the project both proves ownership and yields the database and
  // the project id the audit row needs — the separate project lookup this
  // function used to do at the end is now redundant.
  const project = await resolveProjectContext(userId, input.projectSlug).catch((err: unknown) => {
    if (err instanceof TenancyError) throw new CurationError(err.code, err.message, err.status);
    throw err;
  });
  const corpusDb = project.corpusDb;

  const filters = [eq(schema.documents.projectId, project.projectId)];
  if (input.externalId) {
    filters.push(eq(schema.documents.externalId, input.externalId));
  } else if (input.documentId) {
    filters.push(eq(schema.documents.id, input.documentId));
  }

  const rows = await corpusDb
    .select({
      documentId: schema.documents.id,
      externalId: schema.documents.externalId,
      title: schema.documents.title,
      currentStatus: schema.documents.status,
    })
    .from(schema.documents)
    .where(and(...filters))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new CurationError(
      "document_not_found",
      `Document not found in ${input.projectSlug} for ref ${input.externalId ?? input.documentId}.`,
      404,
    );
  }

  await corpusDb
    .update(schema.documents)
    .set({ status: ARCHIVED_STATUS, updatedAt: sql`now()` })
    .where(eq(schema.documents.id, row.documentId));

  await recordInvocation({
    corpusDb,
    userId,
    projectId: project.projectId,
    operation: "archive_document",
    activityKind: "document_archived",
    targetExternalId: row.externalId,
    sessionId: meta.sessionId,
    status: "success",
    userPrompt: `archive_document ${input.externalId ?? input.documentId} title="${row.title}"`,
    latencyMs: Date.now() - start,
    responseText: row.documentId,
  });

  return {
    documentId: row.documentId,
    externalId: row.externalId,
    title: row.title,
    archivedFrom: row.currentStatus,
  };
}
