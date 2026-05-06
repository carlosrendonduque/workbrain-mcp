import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "./db";

export interface ProjectDetail {
  projectId: string;
  projectSlug: string;
  projectName: string;
  persist: boolean;
  clientId: string;
  clientSlug: string;
  clientName: string;
  conventions: string | null;
  guidelines: string | null;
  architecture: string | null;
  documentCount: number;
  chunkCount: number;
}

export interface DocumentRow {
  documentId: string;
  type: string;
  externalId: string | null;
  title: string;
  path: string;
  status: string | null;
  createdAt: Date | string;
  contentSnippet: string;
  outgoingLinkCount: number;
  incomingLinkCount: number;
}

export interface TypeCount {
  type: string;
  count: number;
}

export async function getProjectByPath(
  userId: string,
  clientSlug: string,
  projectSlug: string,
): Promise<ProjectDetail | null> {
  const rows = await db
    .select({
      projectId: schema.projects.id,
      projectSlug: schema.projects.slug,
      projectName: schema.projects.name,
      persist: schema.projects.persist,
      clientId: schema.clients.id,
      clientSlug: schema.clients.slug,
      clientName: schema.clients.name,
      conventions: schema.projects.conventions,
      guidelines: schema.projects.guidelines,
      architecture: schema.projects.architecture,
    })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(
      and(
        eq(schema.clients.userId, userId),
        eq(schema.clients.slug, clientSlug),
        eq(schema.projects.slug, projectSlug),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const [counts] = await db
    .select({
      documents: sql<number>`count(distinct ${schema.documents.id})::int`,
      chunks: sql<number>`count(${schema.chunks.id})::int`,
    })
    .from(schema.documents)
    .leftJoin(schema.chunks, eq(schema.chunks.documentId, schema.documents.id))
    .where(eq(schema.documents.projectId, row.projectId));

  return {
    ...row,
    documentCount: counts?.documents ?? 0,
    chunkCount: counts?.chunks ?? 0,
  };
}

export async function getTypeCountsForProject(projectId: string): Promise<TypeCount[]> {
  const rows = await db
    .select({
      type: schema.documents.type,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.documents)
    .where(eq(schema.documents.projectId, projectId))
    .groupBy(schema.documents.type)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({ type: r.type, count: r.count }));
}

export interface ListDocumentsOpts {
  type?: string;
  query?: string;
  limit?: number;
}

export async function listDocumentsForProject(
  projectId: string,
  opts: ListDocumentsOpts = {},
): Promise<DocumentRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);

  const filters = [eq(schema.documents.projectId, projectId)];
  if (opts.type) filters.push(eq(schema.documents.type, opts.type));
  if (opts.query) {
    const pattern = `%${opts.query}%`;
    const queryFilter = or(
      ilike(schema.documents.title, pattern),
      ilike(schema.documents.externalId, pattern),
      ilike(schema.documents.path, pattern),
    );
    if (queryFilter) filters.push(queryFilter);
  }

  const rows = await db
    .select({
      documentId: schema.documents.id,
      type: schema.documents.type,
      externalId: schema.documents.externalId,
      title: schema.documents.title,
      path: schema.documents.path,
      status: schema.documents.status,
      createdAt: schema.documents.createdAt,
      contentSnippet: sql<string>`left(${schema.documents.content}, 200)`,
    })
    .from(schema.documents)
    .where(and(...filters))
    .orderBy(desc(schema.documents.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.documentId);

  const [outgoing, incoming] = await Promise.all([
    db
      .select({
        docId: schema.documentLinks.fromDocumentId,
        n: count(schema.documentLinks.id),
      })
      .from(schema.documentLinks)
      .where(inArray(schema.documentLinks.fromDocumentId, ids))
      .groupBy(schema.documentLinks.fromDocumentId),
    db
      .select({
        docId: schema.documentLinks.toDocumentId,
        n: count(schema.documentLinks.id),
      })
      .from(schema.documentLinks)
      .where(inArray(schema.documentLinks.toDocumentId, ids))
      .groupBy(schema.documentLinks.toDocumentId),
  ]);

  const outMap = new Map(outgoing.map((r) => [r.docId, r.n]));
  const inMap = new Map(incoming.map((r) => [r.docId, r.n]));

  return rows.map((r) => ({
    ...r,
    outgoingLinkCount: outMap.get(r.documentId) ?? 0,
    incomingLinkCount: inMap.get(r.documentId) ?? 0,
  }));
}
