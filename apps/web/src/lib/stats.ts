import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "./db";

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

  const [counts] = await db
    .select({
      clients: sql<number>`count(distinct ${schema.clients.id})::int`,
      projects: sql<number>`count(distinct ${schema.projects.id})::int`,
    })
    .from(schema.clients)
    .leftJoin(schema.projects, eq(schema.projects.clientId, schema.clients.id))
    .where(eq(schema.clients.userId, userId));

  const [docs] = await db
    .select({
      documents: sql<number>`count(distinct ${schema.documents.id})::int`,
      chunks: sql<number>`count(${schema.chunks.id})::int`,
    })
    .from(schema.clients)
    .innerJoin(schema.projects, eq(schema.projects.clientId, schema.clients.id))
    .leftJoin(schema.documents, eq(schema.documents.projectId, schema.projects.id))
    .leftJoin(schema.chunks, eq(schema.chunks.documentId, schema.documents.id))
    .where(eq(schema.clients.userId, userId));

  const [invs] = await db
    .select({
      total: sql<number>`count(*)::int`,
      last7d: sql<number>`count(*) filter (where ${schema.invocations.createdAt} >= ${sevenDaysAgo})::int`,
      success7d: sql<number>`count(*) filter (where ${schema.invocations.createdAt} >= ${sevenDaysAgo} and ${schema.invocations.status} = 'success')::int`,
    })
    .from(schema.invocations)
    .where(eq(schema.invocations.userId, userId));

  const last7d = invs?.last7d ?? 0;
  const success7d = invs?.success7d ?? 0;
  const successRateLast7d = last7d === 0 ? null : success7d / last7d;

  return {
    projectCount: counts?.projects ?? 0,
    clientCount: counts?.clients ?? 0,
    documentCount: docs?.documents ?? 0,
    chunkCount: docs?.chunks ?? 0,
    invocationsAllTime: invs?.total ?? 0,
    invocationsLast7d: last7d,
    successRateLast7d,
  };
}

export async function getProjectsForUser(userId: string): Promise<ProjectRow[]> {
  const rows = await db
    .select({
      projectId: schema.projects.id,
      projectSlug: schema.projects.slug,
      projectName: schema.projects.name,
      clientSlug: schema.clients.slug,
      clientName: schema.clients.name,
      persist: schema.projects.persist,
      documentCount: sql<number>`count(distinct ${schema.documents.id})::int`,
      chunkCount: sql<number>`count(${schema.chunks.id})::int`,
      lastInvocationAt: sql<Date | null>`max(${schema.invocations.createdAt})`,
    })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .leftJoin(schema.documents, eq(schema.documents.projectId, schema.projects.id))
    .leftJoin(schema.chunks, eq(schema.chunks.documentId, schema.documents.id))
    .leftJoin(schema.invocations, eq(schema.invocations.projectId, schema.projects.id))
    .where(eq(schema.clients.userId, userId))
    .groupBy(
      schema.projects.id,
      schema.projects.slug,
      schema.projects.name,
      schema.clients.slug,
      schema.clients.name,
      schema.projects.persist,
    )
    .orderBy(schema.clients.slug, schema.projects.slug);

  return rows;
}

export async function getRecentInvocations(
  userId: string,
  limit: number,
): Promise<InvocationRow[]> {
  const rows = await db
    .select({
      id: schema.invocations.id,
      operation: schema.invocations.operation,
      status: schema.invocations.status,
      errorDetail: schema.invocations.errorDetail,
      latencyMs: schema.invocations.latencyMs,
      createdAt: schema.invocations.createdAt,
      projectSlug: schema.projects.slug,
      projectName: schema.projects.name,
    })
    .from(schema.invocations)
    .leftJoin(schema.projects, eq(schema.projects.id, schema.invocations.projectId))
    .where(eq(schema.invocations.userId, userId))
    .orderBy(desc(schema.invocations.createdAt))
    .limit(limit);

  return rows;
}

export interface OperationCount {
  operation: string;
  count: number;
}

export async function getOperationBreakdownLast7d(userId: string): Promise<OperationCount[]> {
  const sevenDaysAgo = SEVEN_DAYS_AGO();
  const rows = await db
    .select({
      operation: schema.invocations.operation,
      count: count(schema.invocations.id),
    })
    .from(schema.invocations)
    .where(
      and(
        eq(schema.invocations.userId, userId),
        gte(schema.invocations.createdAt, sevenDaysAgo),
      ),
    )
    .groupBy(schema.invocations.operation)
    .orderBy(desc(count(schema.invocations.id)));

  return rows.map((r) => ({ operation: r.operation, count: r.count }));
}
