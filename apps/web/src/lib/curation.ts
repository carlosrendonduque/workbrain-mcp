import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type InvocationMeta, recordInvocation } from "./audit";
import { db, schema } from "./db";

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
}

async function resolveOwnedDocument(
  userId: string,
  documentId: string,
): Promise<OwnedDocument> {
  const rows = await db
    .select({
      documentId: schema.documents.id,
      projectId: schema.documents.projectId,
      currentStatus: schema.documents.status,
    })
    .from(schema.documents)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.documents.projectId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(and(eq(schema.clients.userId, userId), eq(schema.documents.id, documentId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new CurationError("document_not_found", `Document ${documentId} not found`, 404);
  }
  return row;
}

export async function archiveDocument(userId: string, documentId: string): Promise<void> {
  await resolveOwnedDocument(userId, documentId);
  await db
    .update(schema.documents)
    .set({ status: ARCHIVED_STATUS, updatedAt: sql`now()` })
    .where(eq(schema.documents.id, documentId));
}

export async function unarchiveDocument(userId: string, documentId: string): Promise<void> {
  await resolveOwnedDocument(userId, documentId);
  await db
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
  const filters = [
    eq(schema.clients.userId, userId),
    eq(schema.projects.slug, input.projectSlug),
  ];
  if (input.externalId) {
    filters.push(eq(schema.documents.externalId, input.externalId));
  } else if (input.documentId) {
    filters.push(eq(schema.documents.id, input.documentId));
  }

  const rows = await db
    .select({
      documentId: schema.documents.id,
      externalId: schema.documents.externalId,
      title: schema.documents.title,
      currentStatus: schema.documents.status,
    })
    .from(schema.documents)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.documents.projectId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
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

  await db
    .update(schema.documents)
    .set({ status: ARCHIVED_STATUS, updatedAt: sql`now()` })
    .where(eq(schema.documents.id, row.documentId));

  // Look up projectId for the audit row.
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

  await recordInvocation({
    userId,
    projectId: projectRows[0]?.id ?? null,
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
