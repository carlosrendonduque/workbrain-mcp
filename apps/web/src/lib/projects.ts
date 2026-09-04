import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { type WorkbrainDb, corpusDbFor, db, schema } from "./db";

export interface ProjectOverview {
  projectSlug: string;
  projectName: string;
  clientSlug: string;
  clientName: string;
  persist: boolean;
  repoUrl: string | null;
  defaultBranch: string | null;
  canon: {
    conventions: boolean;
    guidelines: boolean;
    architecture: boolean;
  };
  documentCount: number;
  documentsByType: Record<string, number>;
  stakeholderCount: number;
  pendingDraftsCount: number;
  recentDocuments: Array<{
    title: string;
    type: string;
    externalId: string | null;
    createdAt: Date | string;
  }>;
  lastInvocationAt: Date | string | null;
}

export async function getProjectOverview(
  userId: string,
  projectSlug: string,
): Promise<ProjectOverview | null> {
  const projectRows = await db
    .select({
      projectId: schema.projects.id,
      projectSlug: schema.projects.slug,
      projectName: schema.projects.name,
      persist: schema.projects.persist,
      conventions: schema.projects.conventions,
      guidelines: schema.projects.guidelines,
      architecture: schema.projects.architecture,
      repoUrl: schema.projects.repoUrl,
      defaultBranch: schema.projects.defaultBranch,
      clientSlug: schema.clients.slug,
      clientName: schema.clients.name,
      isolationMode: schema.clients.isolationMode,
      corpusDbUrlEnv: schema.clients.corpusDbUrlEnv,
    })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(and(eq(schema.clients.userId, userId), eq(schema.projects.slug, projectSlug)))
    .limit(1);

  const project = projectRows[0];
  if (!project) return null;

  // Counts below read this client's content, which may live in its own
  // database — never the central handle.
  const corpusDb = corpusDbFor(project);

  const [docCount] = await corpusDb
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.documents)
    .where(eq(schema.documents.projectId, project.projectId));

  const docsByType = await corpusDb
    .select({
      type: schema.documents.type,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.documents)
    .where(eq(schema.documents.projectId, project.projectId))
    .groupBy(schema.documents.type);

  const [stakeholderCount] = await corpusDb
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.stakeholders)
    .where(eq(schema.stakeholders.projectId, project.projectId));

  const [draftCount] = await corpusDb
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.draftDocuments)
    .where(
      and(
        eq(schema.draftDocuments.projectId, project.projectId),
        eq(schema.draftDocuments.status, "pending"),
      ),
    );

  const recentDocs = await corpusDb
    .select({
      title: schema.documents.title,
      type: schema.documents.type,
      externalId: schema.documents.externalId,
      createdAt: schema.documents.createdAt,
    })
    .from(schema.documents)
    .where(eq(schema.documents.projectId, project.projectId))
    .orderBy(desc(schema.documents.createdAt))
    .limit(5);

  const [lastInv] = await corpusDb
    .select({
      lastAt: sql<Date | null>`max(${schema.invocations.createdAt})`,
    })
    .from(schema.invocations)
    .where(eq(schema.invocations.projectId, project.projectId));

  const documentsByType: Record<string, number> = {};
  for (const r of docsByType) documentsByType[r.type] = r.n;

  return {
    projectSlug: project.projectSlug,
    projectName: project.projectName,
    clientSlug: project.clientSlug,
    clientName: project.clientName,
    persist: project.persist,
    repoUrl: project.repoUrl,
    defaultBranch: project.defaultBranch,
    canon: {
      conventions: Boolean(project.conventions && project.conventions.trim().length > 0),
      guidelines: Boolean(project.guidelines && project.guidelines.trim().length > 0),
      architecture: Boolean(project.architecture && project.architecture.trim().length > 0),
    },
    documentCount: docCount?.n ?? 0,
    documentsByType,
    stakeholderCount: stakeholderCount?.n ?? 0,
    pendingDraftsCount: draftCount?.n ?? 0,
    recentDocuments: recentDocs,
    lastInvocationAt: lastInv?.lastAt ?? null,
  };
}

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
  // Canon domain this project inherits from. Required for new projects;
  // legacy projects created before domains existed have null in DB and the
  // UI nudges the user to assign one from the editor.
  domainId: string;
  // Optional VCS metadata. When set, the agent uses repoUrl to validate or
  // suggest clone, and defaultBranch as the base for feature branches.
  repoUrl?: string;
  defaultBranch?: string;
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
      .where(and(eq(schema.clients.id, input.existingClientId), eq(schema.clients.userId, userId)))
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
      .where(and(eq(schema.clients.userId, userId), eq(schema.clients.slug, input.newClientSlug)))
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
    .where(and(eq(schema.projects.clientId, clientId), eq(schema.projects.slug, input.projectSlug)))
    .limit(1);
  if (dupe[0]) {
    throw new ProjectError(
      "duplicate_project",
      `A project with slug "${input.projectSlug}" already exists under that client.`,
      409,
    );
  }

  // Validate the chosen domain belongs to this user. Cheap defensive query —
  // skip if creation is happening through code paths that don't yet supply
  // a domainId (e.g. legacy seeds), then domain_id stays null.
  const domainRows = await db
    .select({ id: schema.canonDomains.id })
    .from(schema.canonDomains)
    .where(and(eq(schema.canonDomains.id, input.domainId), eq(schema.canonDomains.userId, userId)))
    .limit(1);
  if (!domainRows[0]) {
    throw new ProjectError(
      "domain_not_found",
      "Selected canon domain does not exist for this user.",
      404,
    );
  }

  await db.insert(schema.projects).values({
    clientId,
    domainId: input.domainId,
    slug: input.projectSlug,
    name: input.projectName.trim(),
    persist: input.persist,
    repoUrl: input.repoUrl?.trim() || null,
    defaultBranch: input.defaultBranch?.trim() || null,
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
  repoUrl: string | null;
  defaultBranch: string | null;
  domainId: string | null;
  domainSlug: string | null;
  domainName: string | null;
  documentCount: number;
  chunkCount: number;
  isolationMode: string;
  corpusDbUrlEnv: string | null;
}

export async function setProjectDomain(
  userId: string,
  projectId: string,
  domainId: string,
): Promise<void> {
  // Validate ownership of project AND domain in one shot.
  const projectRows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(and(eq(schema.projects.id, projectId), eq(schema.clients.userId, userId)))
    .limit(1);
  if (!projectRows[0]) {
    throw new ProjectError("project_not_found", "Project not found.", 404);
  }

  const domainRows = await db
    .select({ id: schema.canonDomains.id })
    .from(schema.canonDomains)
    .where(and(eq(schema.canonDomains.id, domainId), eq(schema.canonDomains.userId, userId)))
    .limit(1);
  if (!domainRows[0]) {
    throw new ProjectError(
      "domain_not_found",
      "Selected canon domain does not exist for this user.",
      404,
    );
  }

  await db.update(schema.projects).set({ domainId }).where(eq(schema.projects.id, projectId));
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
  // Compact pattern of the 5-stage progress (e.g. "_·D·_·_·_"). Empty
  // string when not a ticket or all stages empty.
  progressPattern: string;
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
      repoUrl: schema.projects.repoUrl,
      defaultBranch: schema.projects.defaultBranch,
      domainId: schema.projects.domainId,
      domainSlug: schema.canonDomains.slug,
      domainName: schema.canonDomains.name,
      // Plain strings, safe to hand to client components. Callers that need
      // the connection derive it with corpusDbFor(project).
      isolationMode: schema.clients.isolationMode,
      corpusDbUrlEnv: schema.clients.corpusDbUrlEnv,
    })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .leftJoin(schema.canonDomains, eq(schema.canonDomains.id, schema.projects.domainId))
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

  const [counts] = await corpusDbFor(row)
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

export async function getTypeCountsForProject(
  corpusDb: WorkbrainDb,
  projectId: string,
): Promise<TypeCount[]> {
  const rows = await corpusDb
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
  corpusDb: WorkbrainDb,
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

  const rows = await corpusDb
    .select({
      documentId: schema.documents.id,
      type: schema.documents.type,
      externalId: schema.documents.externalId,
      title: schema.documents.title,
      path: schema.documents.path,
      status: schema.documents.status,
      createdAt: schema.documents.createdAt,
      contentSnippet: sql<string>`left(${schema.documents.content}, 200)`,
      progress: schema.documents.progress,
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
    corpusDb
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

  return rows.map((r) => {
    const { progress: rawProgress, ...rest } = r;
    return {
      ...rest,
      outgoingLinkCount: outMap.get(r.documentId) ?? 0,
      incomingLinkCount: inMap.get(r.documentId) ?? 0,
      progressPattern: r.type === "ticket" ? buildProgressPattern(rawProgress) : "",
    };
  });
}

const PROGRESS_STAGE_KEYS = ["analysis", "design", "build", "tests", "deployment"] as const;

function buildProgressPattern(raw: unknown): string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return PROGRESS_STAGE_KEYS.map(() => "_").join("·");
  }
  const obj = raw as Record<string, unknown>;
  return PROGRESS_STAGE_KEYS.map((s) => {
    const v = obj[s];
    return typeof v === "string" && v.trim().length > 0 ? s.charAt(0).toUpperCase() : "_";
  }).join("·");
}
