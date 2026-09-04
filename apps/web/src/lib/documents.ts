import { and, eq } from "drizzle-orm";
import { type WorkbrainDb, schema } from "./db";
import { TenancyError, resolveProjectContext } from "./tenancy";

export interface DocumentProgress {
  analysis: string | null;
  design: string | null;
  build: string | null;
  tests: string | null;
  deployment: string | null;
}

export interface DocumentDetail {
  documentId: string;
  type: string;
  externalId: string | null;
  title: string;
  path: string;
  status: string | null;
  content: string;
  frontmatter: Record<string, unknown>;
  progress: DocumentProgress;
  createdAt: Date | string;
  updatedAt: Date | string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  clientId: string;
  clientSlug: string;
  clientName: string;
  isolationMode: string;
  corpusDbUrlEnv: string | null;
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

const PROGRESS_STAGES = ["analysis", "design", "build", "tests", "deployment"] as const;

function normalizeProgress(raw: unknown): DocumentProgress {
  const empty: DocumentProgress = {
    analysis: null,
    design: null,
    build: null,
    tests: null,
    deployment: null,
  };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return empty;
  const obj = raw as Record<string, unknown>;
  const out = { ...empty };
  for (const stage of PROGRESS_STAGES) {
    const v = obj[stage];
    if (typeof v === "string" && v.trim().length > 0) out[stage] = v;
  }
  return out;
}

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
  const refMatch = refIsUuid ? eq(schema.documents.id, ref) : eq(schema.documents.externalId, ref);

  // The project and client come from the central registry; the document
  // itself lives in the client's database, so the old three-way join is now
  // a lookup plus a scoped query.
  let project: Awaited<ReturnType<typeof resolveProjectContext>>;
  try {
    project = await resolveProjectContext(userId, projectSlug);
  } catch (err) {
    if (err instanceof TenancyError) return null;
    throw err;
  }
  if (project.clientSlug !== clientSlug) return null;

  const rows = await project.corpusDb
    .select({
      documentId: schema.documents.id,
      type: schema.documents.type,
      externalId: schema.documents.externalId,
      title: schema.documents.title,
      path: schema.documents.path,
      status: schema.documents.status,
      content: schema.documents.content,
      frontmatter: schema.documents.frontmatter,
      progress: schema.documents.progress,
      createdAt: schema.documents.createdAt,
      updatedAt: schema.documents.updatedAt,
    })
    .from(schema.documents)
    .where(and(eq(schema.documents.projectId, project.projectId), refMatch))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    projectId: project.projectId,
    projectSlug: project.projectSlug,
    projectName: project.projectName,
    clientId: project.clientId,
    clientSlug: project.clientSlug,
    clientName: project.clientName,
    isolationMode: project.isolationMode,
    corpusDbUrlEnv: project.corpusDbUrlEnv,
    frontmatter: isObjectRecord(row.frontmatter) ? row.frontmatter : {},
    progress: normalizeProgress(row.progress),
  };
}

export interface DocumentLinks {
  outgoing: DocumentLink[];
  incoming: DocumentLink[];
}

export async function getDocumentLinks(
  corpusDb: WorkbrainDb,
  documentId: string,
): Promise<DocumentLinks> {
  const [outRows, inRows] = await Promise.all([
    corpusDb
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
    corpusDb
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
