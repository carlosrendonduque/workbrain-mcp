import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { corpusMapForUser, fanOutCorpus } from "./tenancy";

/**
 * Dashboard aggregates.
 *
 * Counts used to be one SQL statement joining clients -> projects ->
 * documents -> chunks -> invocations. Documents, chunks and invocations now
 * follow the client, so each figure is gathered per database and summed here.
 * For a user whose clients are all shared that is still a single query — every
 * shared client resolves to the same handle and collapses into one target.
 */

export interface OverviewStats {
  projectCount: number;
  clientCount: number;
  documentCount: number;
  chunkCount: number;
  invocationsAllTime: number;
  invocationsLast7d: number;
  successRateLast7d: number | null;
}

export interface ProjectRow {
  projectId: string;
  projectSlug: string;
  projectName: string;
  clientSlug: string;
  clientName: string;
  persist: boolean;
  documentCount: number;
  chunkCount: number;
  lastInvocationAt: Date | null;
}

export interface InvocationRow {
  id: string;
  operation: string;
  status: string;
  errorDetail: string | null;
  latencyMs: number | null;
  createdAt: Date;
  projectSlug: string | null;
  projectName: string | null;
}

const SEVEN_DAYS_AGO = (): Date => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

export async function getOverviewStats(userId: string): Promise<OverviewStats> {
  const sevenDaysAgo = SEVEN_DAYS_AGO();
  const map = await corpusMapForUser(userId);

  // Clients and projects are central — still one query.
  const [counts] = await db
    .select({
      clients: sql<number>`count(distinct ${schema.clients.id})::int`,
      projects: sql<number>`count(distinct ${schema.projects.id})::int`,
    })
    .from(schema.clients)
    .leftJoin(schema.projects, eq(schema.projects.clientId, schema.clients.id))
    .where(eq(schema.clients.userId, userId));

  const docRows = await fanOutCorpus(map, async (t) => {
    if (t.projectIds.length === 0) return [];
    return await t.db
      .select({
        documents: sql<number>`count(distinct ${schema.documents.id})::int`,
        chunks: sql<number>`count(${schema.chunks.id})::int`,
      })
      .from(schema.documents)
      .leftJoin(schema.chunks, eq(schema.chunks.documentId, schema.documents.id))
      .where(inArray(schema.documents.projectId, t.projectIds));
  });

  const invRows = await fanOutCorpus(map, (t) =>
    t.db
      .select({
        total: sql<number>`count(*)::int`,
        last7d: sql<number>`count(*) filter (where ${schema.invocations.createdAt} >= ${sevenDaysAgo})::int`,
        success7d: sql<number>`count(*) filter (where ${schema.invocations.createdAt} >= ${sevenDaysAgo} and ${schema.invocations.status} = 'success')::int`,
      })
      .from(schema.invocations)
      .where(eq(schema.invocations.userId, userId)),
  );

  const documentCount = docRows.reduce((a, r) => a + (r.documents ?? 0), 0);
  const chunkCount = docRows.reduce((a, r) => a + (r.chunks ?? 0), 0);
  const total = invRows.reduce((a, r) => a + (r.total ?? 0), 0);
  const last7d = invRows.reduce((a, r) => a + (r.last7d ?? 0), 0);
  const success7d = invRows.reduce((a, r) => a + (r.success7d ?? 0), 0);
  const successRateLast7d = last7d === 0 ? null : success7d / last7d;

  return {
    projectCount: counts?.projects ?? 0,
    clientCount: counts?.clients ?? 0,
    documentCount,
    chunkCount,
    invocationsAllTime: total,
    invocationsLast7d: last7d,
    successRateLast7d,
  };
}

export async function getProjectsForUser(userId: string): Promise<ProjectRow[]> {
  const map = await corpusMapForUser(userId);

  const base = await db
    .select({
      projectId: schema.projects.id,
      projectSlug: schema.projects.slug,
      projectName: schema.projects.name,
      clientSlug: schema.clients.slug,
      clientName: schema.clients.name,
      persist: schema.projects.persist,
    })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(eq(schema.clients.userId, userId))
    .orderBy(schema.clients.slug, schema.projects.slug);

  const perProject = await fanOutCorpus(map, async (t) => {
    if (t.projectIds.length === 0) return [];
    return await t.db
      .select({
        projectId: schema.documents.projectId,
        documentCount: sql<number>`count(distinct ${schema.documents.id})::int`,
        chunkCount: sql<number>`count(${schema.chunks.id})::int`,
      })
      .from(schema.documents)
      .leftJoin(schema.chunks, eq(schema.chunks.documentId, schema.documents.id))
      .where(inArray(schema.documents.projectId, t.projectIds))
      .groupBy(schema.documents.projectId);
  });

  const lastSeen = await fanOutCorpus(map, async (t) => {
    if (t.projectIds.length === 0) return [];
    return await t.db
      .select({
        projectId: schema.invocations.projectId,
        lastInvocationAt: sql<Date | null>`max(${schema.invocations.createdAt})`,
      })
      .from(schema.invocations)
      .where(inArray(schema.invocations.projectId, t.projectIds))
      .groupBy(schema.invocations.projectId);
  });

  const docsBy = new Map(perProject.map((r) => [r.projectId, r]));
  const lastBy = new Map(
    lastSeen.filter((r) => r.projectId !== null).map((r) => [r.projectId as string, r]),
  );

  return base.map((p) => ({
    ...p,
    documentCount: docsBy.get(p.projectId)?.documentCount ?? 0,
    chunkCount: docsBy.get(p.projectId)?.chunkCount ?? 0,
    lastInvocationAt: lastBy.get(p.projectId)?.lastInvocationAt ?? null,
  }));
}

export async function getRecentInvocations(
  userId: string,
  limit: number,
): Promise<InvocationRow[]> {
  const map = await corpusMapForUser(userId);

  const merged = await fanOutCorpus(map, (t) =>
    t.db
      .select({
        id: schema.invocations.id,
        operation: schema.invocations.operation,
        status: schema.invocations.status,
        errorDetail: schema.invocations.errorDetail,
        latencyMs: schema.invocations.latencyMs,
        createdAt: schema.invocations.createdAt,
        projectId: schema.invocations.projectId,
      })
      .from(schema.invocations)
      .where(eq(schema.invocations.userId, userId))
      .orderBy(desc(schema.invocations.createdAt))
      .limit(limit),
  );

  return merged
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .map((r) => {
      const label = r.projectId ? map.labels.get(r.projectId) : undefined;
      return {
        id: r.id,
        operation: r.operation,
        status: r.status,
        errorDetail: r.errorDetail,
        latencyMs: r.latencyMs,
        createdAt: r.createdAt,
        projectSlug: label?.projectSlug ?? null,
        projectName: label?.projectName ?? null,
      };
    });
}

export interface OperationCount {
  operation: string;
  count: number;
}

export async function getOperationBreakdownLast7d(userId: string): Promise<OperationCount[]> {
  const sevenDaysAgo = SEVEN_DAYS_AGO();
  const map = await corpusMapForUser(userId);

  const rows = await fanOutCorpus(map, (t) =>
    t.db
      .select({
        operation: schema.invocations.operation,
        count: count(schema.invocations.id),
      })
      .from(schema.invocations)
      .where(
        and(eq(schema.invocations.userId, userId), gte(schema.invocations.createdAt, sevenDaysAgo)),
      )
      .groupBy(schema.invocations.operation),
  );

  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.operation, (totals.get(r.operation) ?? 0) + r.count);
  return [...totals.entries()]
    .map(([operation, count]) => ({ operation, count }))
    .sort((a, b) => b.count - a.count);
}
