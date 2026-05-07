import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "./db";

export class ProjectError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ProjectError";
    this.code = code;
    this.status = status;
  }
}

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function validateSlug(name: string, value: string): void {
  if (!SLUG_PATTERN.test(value)) {
    throw new ProjectError(
      "invalid_slug",
      `${name} must be lowercase letters, numbers and dashes (1-64 chars, no leading/trailing dash). Got: "${value}".`,
      400,
    );
  }
}

export interface ClientRow {
  clientId: string;
  clientSlug: string;
  clientName: string;
}

export async function listClientsForUser(userId: string): Promise<ClientRow[]> {
  const rows = await db
    .select({
      clientId: schema.clients.id,
      clientSlug: schema.clients.slug,
      clientName: schema.clients.name,
    })
    .from(schema.clients)
    .where(eq(schema.clients.userId, userId))
    .orderBy(schema.clients.slug);
  return rows;
}

export interface CreateProjectInput {
  // Either pick an existing client by id...
  existingClientId?: string;
  // ...or create a new one with these fields:
  newClientSlug?: string;
  newClientName?: string;
  // Project fields:
  projectSlug: string;
  projectName: string;
  persist: boolean;
}

export interface CreatedProject {
  clientSlug: string;
  projectSlug: string;
}

export async function createProject(
  userId: string,
  input: CreateProjectInput,
): Promise<CreatedProject> {
  validateSlug("Project slug", input.projectSlug);
  if (input.projectName.trim().length === 0) {
    throw new ProjectError("missing_project_name", "Project name is required.", 400);
  }

  let clientId: string;
  let clientSlug: string;

  if (input.existingClientId) {
    const rows = await db
      .select({
        clientId: schema.clients.id,
        clientSlug: schema.clients.slug,
      })
      .from(schema.clients)
      .where(
        and(eq(schema.clients.id, input.existingClientId), eq(schema.clients.userId, userId)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new ProjectError("client_not_found", "Selected client does not exist.", 404);
    }
    clientId = row.clientId;
    clientSlug = row.clientSlug;
  } else {
    if (!input.newClientSlug || !input.newClientName) {
      throw new ProjectError(
        "missing_client",
        "Pick an existing client or provide a new client slug + name.",
        400,
      );
    }
    validateSlug("Client slug", input.newClientSlug);

    // Check for slug collision under this user.
    const existing = await db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.userId, userId),
          eq(schema.clients.slug, input.newClientSlug),
        ),
      )
      .limit(1);
    if (existing[0]) {
      throw new ProjectError(
        "duplicate_client",
        `A client with slug "${input.newClientSlug}" already exists.`,
        409,
      );
    }

    const inserted = await db
      .insert(schema.clients)
      .values({
        userId,
        slug: input.newClientSlug,
        name: input.newClientName.trim(),
      })
      .returning({ id: schema.clients.id, slug: schema.clients.slug });
    const row = inserted[0];
    if (!row) {
      throw new ProjectError("client_insert_failed", "Failed to create client.", 500);
    }
    clientId = row.id;
    clientSlug = row.slug;
  }

  // Project slug must be unique within the chosen client.
  const dupe = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.clientId, clientId), eq(schema.projects.slug, input.projectSlug)),
    )
    .limit(1);
  if (dupe[0]) {
    throw new ProjectError(
      "duplicate_project",
      `A project with slug "${input.projectSlug}" already exists under that client.`,
      409,
    );
  }

  await db.insert(schema.projects).values({
    clientId,
    slug: input.projectSlug,
    name: input.projectName.trim(),
    persist: input.persist,
  });

  return { clientSlug, projectSlug: input.projectSlug };
}

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
