import { schema } from "@workbrain/shared";
import { and, eq } from "drizzle-orm";
import { type WorkbrainDb, corpusDbFor, db } from "./db";

/**
 * Resolving "which database holds this?" happens on every corpus read and
 * write, so it lives in one place.
 *
 * The rule this module enforces: the registry (users, api keys, clients,
 * projects, canon domains) is always central; a client's content always
 * follows the client. A query may not span the two — Postgres cannot join
 * across databases — so anything that used to be one join is now a central
 * lookup plus a corpus query, stitched together here.
 */

/**
 * How far a caller may reach.
 *
 * `null` means every client the user owns — a browser session, or an API key
 * that was never scoped. A client id means the caller may touch that client
 * and nothing else, which is what an API key pinned to one client carries.
 *
 * Every function here takes it as a REQUIRED argument rather than an optional
 * one. Optional would fail open: forget to pass it at one call site and a
 * scoped key silently gets full access. Required makes the compiler ask the
 * question at every call site, and callers that are legitimately unscoped say
 * so by passing null.
 */
export type ClientScope = string | null;

/** A project outside the caller's scope is reported as missing, never as
 * forbidden — "forbidden" would confirm that a project with that slug exists
 * under another client, which is exactly what a scoped key must not learn. */
function outOfScope(scope: ClientScope, clientId: string): boolean {
  return scope !== null && scope !== clientId;
}

export class TenancyError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "TenancyError";
    this.code = code;
    this.status = status;
  }
}

export interface ProjectContext {
  projectId: string;
  projectSlug: string;
  projectName: string;
  persist: boolean;
  domainId: string | null;
  conventions: string | null;
  guidelines: string | null;
  architecture: string | null;
  repoUrl: string | null;
  defaultBranch: string | null;
  clientId: string;
  clientSlug: string;
  clientName: string;
  isolationMode: string;
  corpusDbUrlEnv: string | null;
  llmProvider: string;
  llmConfig: unknown;
  embeddingProvider: string;
  embeddingConfig: unknown;
  retentionDays: number | null;
  /** The database holding this project's documents, chunks and audit rows. */
  corpusDb: WorkbrainDb;
}

const projectColumns = {
  projectId: schema.projects.id,
  projectSlug: schema.projects.slug,
  projectName: schema.projects.name,
  persist: schema.projects.persist,
  domainId: schema.projects.domainId,
  conventions: schema.projects.conventions,
  guidelines: schema.projects.guidelines,
  architecture: schema.projects.architecture,
  repoUrl: schema.projects.repoUrl,
  defaultBranch: schema.projects.defaultBranch,
  clientId: schema.clients.id,
  clientSlug: schema.clients.slug,
  clientName: schema.clients.name,
  isolationMode: schema.clients.isolationMode,
  corpusDbUrlEnv: schema.clients.corpusDbUrlEnv,
  llmProvider: schema.clients.llmProvider,
  llmConfig: schema.clients.llmConfig,
  embeddingProvider: schema.clients.embeddingProvider,
  embeddingConfig: schema.clients.embeddingConfig,
  retentionDays: schema.clients.retentionDays,
} as const;

function withCorpusDb(row: Omit<ProjectContext, "corpusDb">): ProjectContext {
  return { ...row, corpusDb: corpusDbFor(row) };
}

/** Look up a project by slug within one user's clients, honouring the scope. */
export async function resolveProjectContext(
  userId: string,
  projectSlug: string,
  scope: ClientScope,
): Promise<ProjectContext> {
  const rows = await db
    .select(projectColumns)
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.projects.clientId, schema.clients.id))
    .where(and(eq(schema.clients.userId, userId), eq(schema.projects.slug, projectSlug)))
    .limit(1);

  const row = rows[0];
  if (!row || outOfScope(scope, row.clientId)) {
    throw new TenancyError(
      "project_not_found",
      `Project not found for active user: ${projectSlug}`,
      404,
    );
  }
  return withCorpusDb(row);
}

/** Same, by project id — for callers that already hold one. */
export async function resolveProjectContextById(
  userId: string,
  projectId: string,
  scope: ClientScope,
): Promise<ProjectContext> {
  const rows = await db
    .select(projectColumns)
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.projects.clientId, schema.clients.id))
    .where(and(eq(schema.clients.userId, userId), eq(schema.projects.id, projectId)))
    .limit(1);

  const row = rows[0];
  if (!row || outOfScope(scope, row.clientId)) {
    throw new TenancyError("project_not_found", "Project not found for active user", 404);
  }
  return withCorpusDb(row);
}

/**
 * One database that holds corpus for some of a user's projects, plus the
 * project ids it covers.
 *
 * Cross-project screens (dashboard, audit, drafts inbox) used to be a single
 * query joined to projects. They now run once per target and merge. For a
 * user whose clients are all shared this is still exactly one query, because
 * every shared client resolves to the same handle and collapses into one
 * target.
 */
export interface CorpusTarget {
  key: string;
  db: WorkbrainDb;
  clientIds: string[];
  projectIds: string[];
}

/** Display metadata for a project, kept centrally. */
export interface ProjectLabel {
  projectId: string;
  projectSlug: string;
  projectName: string;
  clientId: string;
  clientSlug: string;
  clientName: string;
}

export interface UserCorpusMap {
  targets: CorpusTarget[];
  /** Every project the user owns, by id — for labelling fanned-out rows. */
  labels: Map<string, ProjectLabel>;
  /** Every project id the user owns, in one flat list. */
  allProjectIds: string[];
}

/** One row of the central registry: a project and where its client lives. */
export interface ProjectPlacement {
  projectId: string;
  projectSlug: string;
  projectName: string;
  clientId: string;
  clientSlug: string;
  clientName: string;
  isolationMode: string;
  corpusDbUrlEnv: string | null;
}

/**
 * Group placements by the database that holds them. Pure, so the grouping
 * rule — every shared client collapses into one target, each dedicated
 * connection gets its own — is testable without a database.
 */
export function groupByCorpus(rows: ProjectPlacement[], scope: ClientScope): UserCorpusMap {
  const byKey = new Map<string, CorpusTarget>();
  const labels = new Map<string, ProjectLabel>();
  const allProjectIds: string[] = [];

  // The central database is always a target, even for a user whose every
  // client is dedicated. Some audit rows are recorded before a project is
  // resolved (a bad slug, an auth failure) and have no client to follow, so
  // they land centrally and would otherwise be invisible.
  byKey.set("shared", { key: "shared", db, clientIds: [], projectIds: [] });

  for (const row of rows) {
    // Out-of-scope clients are dropped here rather than filtered by each
    // caller, so a scoped key's dashboard, audit and drafts inbox all narrow
    // for free.
    if (outOfScope(scope, row.clientId)) continue;

    labels.set(row.projectId, {
      projectId: row.projectId,
      projectSlug: row.projectSlug,
      projectName: row.projectName,
      clientId: row.clientId,
      clientSlug: row.clientSlug,
      clientName: row.clientName,
    });
    allProjectIds.push(row.projectId);

    const key =
      row.isolationMode === "dedicated" ? `dedicated:${row.corpusDbUrlEnv ?? "?"}` : "shared";

    const existing = byKey.get(key);
    if (existing) {
      if (!existing.clientIds.includes(row.clientId)) existing.clientIds.push(row.clientId);
      existing.projectIds.push(row.projectId);
      continue;
    }
    byKey.set(key, {
      key,
      db: corpusDbFor(row),
      clientIds: [row.clientId],
      projectIds: [row.projectId],
    });
  }

  return { targets: [...byKey.values()], labels, allProjectIds };
}

/**
 * Group a user's projects by the database that holds their corpus.
 *
 * Callers that only need one project should use `resolveProjectContext`;
 * this is for the screens that legitimately span clients.
 */
export async function corpusMapForUser(userId: string, scope: ClientScope): Promise<UserCorpusMap> {
  const rows = await db
    .select({
      projectId: schema.projects.id,
      projectSlug: schema.projects.slug,
      projectName: schema.projects.name,
      clientId: schema.clients.id,
      clientSlug: schema.clients.slug,
      clientName: schema.clients.name,
      isolationMode: schema.clients.isolationMode,
      corpusDbUrlEnv: schema.clients.corpusDbUrlEnv,
    })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.projects.clientId, schema.clients.id))
    .where(eq(schema.clients.userId, userId));

  return groupByCorpus(rows, scope);
}

/**
 * Run a query against every database holding any of a user's corpus and
 * concatenate the results.
 *
 * Ordering and pagination cannot be pushed into SQL once results come from
 * more than one database — sort and slice the merged array afterwards. Ask
 * each target for enough rows to cover the window you need.
 */
export async function fanOutCorpus<T>(
  map: UserCorpusMap,
  run: (target: CorpusTarget) => Promise<T[]>,
): Promise<T[]> {
  if (map.targets.length === 0) return [];
  if (map.targets.length === 1) {
    const only = map.targets[0];
    return only ? await run(only) : [];
  }
  const results = await Promise.all(map.targets.map(run));
  return results.flat();
}
