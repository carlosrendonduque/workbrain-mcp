import { type SQL, and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "./db";

export interface InvocationDetail {
  id: string;
  operation: string;
  status: string;
  errorDetail: string | null;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: string | null;
  provider: string;
  model: string;
  userPrompt: string;
  retrievedChunks: unknown;
  responseText: string | null;
  createdAt: Date | string;
  projectId: string | null;
  projectSlug: string | null;
  projectName: string | null;
  clientSlug: string | null;
}

export interface ListInvocationsOpts {
  projectId?: string;
  operation?: string;
  status?: "success" | "error";
  page?: number;
  pageSize?: number;
}

export interface ListInvocationsResult {
  rows: InvocationDetail[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function listInvocations(
  userId: string,
  opts: ListInvocationsOpts = {},
): Promise<ListInvocationsResult> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const requestedPage = Math.max(opts.page ?? 1, 1);

  const filters: SQL[] = [eq(schema.invocations.userId, userId)];
  if (opts.projectId) filters.push(eq(schema.invocations.projectId, opts.projectId));
  if (opts.operation) filters.push(eq(schema.invocations.operation, opts.operation));
  if (opts.status) filters.push(eq(schema.invocations.status, opts.status));

  const where = and(...filters);

  const totalRow = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.invocations)
    .where(where)
    .then((r) => r[0]);

  const total = totalRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  const rows = await db
      .select({
        id: schema.invocations.id,
        operation: schema.invocations.operation,
        status: schema.invocations.status,
        errorDetail: schema.invocations.errorDetail,
        latencyMs: schema.invocations.latencyMs,
        promptTokens: schema.invocations.promptTokens,
        completionTokens: schema.invocations.completionTokens,
        costUsd: schema.invocations.costUsd,
        provider: schema.invocations.provider,
        model: schema.invocations.model,
        userPrompt: schema.invocations.userPrompt,
        retrievedChunks: schema.invocations.retrievedChunks,
        responseText: schema.invocations.responseText,
        createdAt: schema.invocations.createdAt,
        projectId: schema.invocations.projectId,
        projectSlug: schema.projects.slug,
        projectName: schema.projects.name,
        clientSlug: schema.clients.slug,
      })
      .from(schema.invocations)
      .leftJoin(schema.projects, eq(schema.projects.id, schema.invocations.projectId))
      .leftJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
      .where(where)
      .orderBy(desc(schema.invocations.createdAt))
      .limit(pageSize)
      .offset(offset);

  return { rows, total, page, pageSize, totalPages };
}

export async function getDistinctOperations(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ operation: schema.invocations.operation })
    .from(schema.invocations)
    .where(eq(schema.invocations.userId, userId))
    .orderBy(schema.invocations.operation);
  return rows.map((r) => r.operation);
}
