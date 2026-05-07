import { and, eq, sql } from "drizzle-orm";
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
