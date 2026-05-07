import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";

export interface DocumentDetail {
  documentId: string;
  type: string;
  externalId: string | null;
  title: string;
  path: string;
  status: string | null;
  content: string;
  frontmatter: Record<string, unknown>;
  createdAt: Date | string;
  updatedAt: Date | string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  clientId: string;
  clientSlug: string;
  clientName: string;
}

export interface DocumentLink {
  linkId: string;
  linkType: string;
  note: string | null;
  createdAt: Date | string;
  documentId: string;
  type: string;
  externalId: string | null;
  title: string;
  path: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function getDocumentDetail(
  userId: string,
  clientSlug: string,
  projectSlug: string,
  ref: string,
): Promise<DocumentDetail | null> {
  const refIsUuid = UUID_PATTERN.test(ref);
  const refMatch = refIsUuid
    ? eq(schema.documents.id, ref)
    : eq(schema.documents.externalId, ref);

  const rows = await db
    .select({
      documentId: schema.documents.id,
      type: schema.documents.type,
      externalId: schema.documents.externalId,
      title: schema.documents.title,
      path: schema.documents.path,
      status: schema.documents.status,
      content: schema.documents.content,
      frontmatter: schema.documents.frontmatter,
      createdAt: schema.documents.createdAt,
      updatedAt: schema.documents.updatedAt,
      projectId: schema.projects.id,
      projectSlug: schema.projects.slug,
      projectName: schema.projects.name,
      clientId: schema.clients.id,
      clientSlug: schema.clients.slug,
      clientName: schema.clients.name,
    })
    .from(schema.documents)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.documents.projectId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(
      and(
        eq(schema.clients.userId, userId),
        eq(schema.clients.slug, clientSlug),
        eq(schema.projects.slug, projectSlug),
        refMatch,
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    frontmatter: isObjectRecord(row.frontmatter) ? row.frontmatter : {},
  };
}

export interface DocumentLinks {
  outgoing: DocumentLink[];
  incoming: DocumentLink[];
}

export async function getDocumentLinks(documentId: string): Promise<DocumentLinks> {
  const [outRows, inRows] = await Promise.all([
    db
      .select({
        linkId: schema.documentLinks.id,
        linkType: schema.documentLinks.linkType,
        note: schema.documentLinks.note,
        createdAt: schema.documentLinks.createdAt,
        documentId: schema.documents.id,
        type: schema.documents.type,
        externalId: schema.documents.externalId,
        title: schema.documents.title,
        path: schema.documents.path,
      })
      .from(schema.documentLinks)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.documentLinks.toDocumentId))
      .where(eq(schema.documentLinks.fromDocumentId, documentId))
      .orderBy(schema.documentLinks.linkType, schema.documents.externalId),
    db
      .select({
        linkId: schema.documentLinks.id,
        linkType: schema.documentLinks.linkType,
        note: schema.documentLinks.note,
        createdAt: schema.documentLinks.createdAt,
        documentId: schema.documents.id,
        type: schema.documents.type,
        externalId: schema.documents.externalId,
        title: schema.documents.title,
        path: schema.documents.path,
      })
      .from(schema.documentLinks)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.documentLinks.fromDocumentId))
      .where(eq(schema.documentLinks.toDocumentId, documentId))
      .orderBy(schema.documentLinks.linkType, schema.documents.externalId),
  ]);

  return { outgoing: outRows, incoming: inRows };
}
