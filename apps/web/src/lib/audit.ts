import { type SQL, and, desc, eq, sql } from "drizzle-orm";
import { type WorkbrainDb, schema } from "./db";
import { type ClientScope, corpusMapForUser, fanOutCorpus } from "./tenancy";

export interface InvocationDetail {
  id: string;
  operation: string;
  activityKind: string | null;
  targetExternalId: string | null;
  sessionId: string | null;
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

// Stable, semantic kinds of activity for the project feed. Only mutations
// land in the feed (reads stay in /audit). Add new kinds here as the
// surface grows; the feed renderer falls back to the raw operation name
// for unknown kinds.
export const ACTIVITY_KINDS = [
  "draft_proposed",
  "draft_approved",
  "draft_rejected",
  "draft_archived",
  "document_ingested",
  "document_archived",
  "document_linked",
  "ticket_progress_set",
  "canon_project_edited",
  "canon_domain_edited",
  "canon_domain_created",
  "project_domain_assigned",
  "project_created",
  "project_repo_updated",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

// Who is calling and how far they may reach. Travels through every lib
// operation: `sessionId` so the audit row knows which chat triggered it,
// `clientScope` so the operation cannot touch a client the caller is not
// entitled to.
//
// `clientScope` is REQUIRED on purpose. Optional would fail open — one
// forgotten call site and an API key pinned to one client quietly gets all of
// them. Callers that are legitimately unscoped (the webapp, where the owner
// is signed in, and one-off scripts) say so by passing null.
export interface InvocationMeta {
  sessionId?: string | null;
  clientScope: ClientScope;
}

interface RecordInvocationInput {
  /**
   * The database this row belongs in — the client's corpus database, from
   * `resolveProjectContext(...).corpusDb`. An invocation carries the prompt
   * and the retrieved chunks, so it is client content and follows the client.
   * Pass the central handle only for rows with no project (an unknown slug,
   * a rejected key), which belong to no client.
   */
  corpusDb: WorkbrainDb;
  userId: string;
  projectId: string | null;
  operation: string;
  activityKind?: ActivityKind | null;
  targetExternalId?: string | null;
  sessionId?: string | null;
  status: "success" | "error";
  userPrompt?: string;
  systemPrompt?: string;
  retrievedChunks?: unknown;
  responseText?: string | null;
  provider?: string;
  model?: string;
  errorDetail?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costUsd?: string | null;
  latencyMs?: number | null;
}

// Single insert path for everything that ends up in the audit table. Never
// throws — invocations are observability and must not break the user-facing
// operation if they fail. Errors are logged to stderr.
export async function recordInvocation(input: RecordInvocationInput): Promise<void> {
  try {
    await input.corpusDb.insert(schema.invocations).values({
      userId: input.userId,
      projectId: input.projectId,
      operation: input.operation,
      activityKind: input.activityKind ?? null,
      targetExternalId: input.targetExternalId ?? null,
      sessionId: input.sessionId ?? null,
      userPrompt: input.userPrompt ?? "",
      systemPrompt: input.systemPrompt ?? "",
      retrievedChunks: input.retrievedChunks ?? [],
      responseText: input.responseText ?? null,
      provider: input.provider ?? "none",
      model: input.model ?? "none",
      status: input.status,
      errorDetail: input.errorDetail ?? null,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      costUsd: input.costUsd ?? null,
      latencyMs: input.latencyMs ?? null,
    });
  } catch (err) {
    console.error(`recordInvocation failed for ${input.operation}:`, err);
  }
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
  scope: ClientScope,
  opts: ListInvocationsOpts = {},
): Promise<ListInvocationsResult> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const requestedPage = Math.max(opts.page ?? 1, 1);

  const map = await corpusMapForUser(userId, scope);

  const filters: SQL[] = [eq(schema.invocations.userId, userId)];
  if (opts.projectId) filters.push(eq(schema.invocations.projectId, opts.projectId));
  if (opts.operation) filters.push(eq(schema.invocations.operation, opts.operation));
  if (opts.status) filters.push(eq(schema.invocations.status, opts.status));

  const where = and(...filters);

  const counts = await Promise.all(
    map.targets.map((t) =>
      t.db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.invocations)
        .where(where)
        .then((r) => r[0]?.total ?? 0),
    ),
  );
  const total = counts.reduce((a, b) => a + b, 0);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  // Ordering and paging cannot be pushed into SQL once rows come from more
  // than one database. Each target returns enough rows to cover the window,
  // then the merged list is sorted and sliced. Cheap while a user has a
  // handful of clients; revisit if that stops being true.
  const window = offset + pageSize;
  const merged = await fanOutCorpus(map, (t) =>
    t.db
      .select({
        id: schema.invocations.id,
        operation: schema.invocations.operation,
        activityKind: schema.invocations.activityKind,
        targetExternalId: schema.invocations.targetExternalId,
        sessionId: schema.invocations.sessionId,
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
      })
      .from(schema.invocations)
      .where(where)
      .orderBy(desc(schema.invocations.createdAt))
      .limit(window),
  );

  const rows: InvocationDetail[] = merged
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(offset, offset + pageSize)
    .map((r) => {
      const label = r.projectId ? map.labels.get(r.projectId) : undefined;
      return {
        ...r,
        projectSlug: label?.projectSlug ?? null,
        projectName: label?.projectName ?? null,
        clientSlug: label?.clientSlug ?? null,
      };
    });

  return { rows, total, page, pageSize, totalPages };
}

// Activity feed row — one mutation, human-legible. Reads stay out of the
// feed (operation NOT NULL on activityKind filter) so the surface remains
// scannable. Drill into /audit?session=... for the raw row.
export interface ActivityRow {
  id: string;
  ts: Date | string;
  actor: "agent" | "user";
  kind: string;
  operation: string;
  status: string;
  targetExternalId: string | null;
  sessionId: string | null;
  description: string;
  errorDetail: string | null;
}

interface ListActivityOpts {
  projectId?: string;
  sessionId?: string;
  limit?: number;
}

export async function listActivity(
  userId: string,
  scope: ClientScope,
  opts: ListActivityOpts = {},
): Promise<ActivityRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  const filters: SQL[] = [
    eq(schema.invocations.userId, userId),
    // Only mutations land in the feed — kinds were set explicitly in
    // recordInvocation. Reads (search, compose_context, list_*) have NULL
    // activityKind and are filtered out here.
    sql`${schema.invocations.activityKind} is not null`,
  ];
  if (opts.projectId) filters.push(eq(schema.invocations.projectId, opts.projectId));
  if (opts.sessionId) filters.push(eq(schema.invocations.sessionId, opts.sessionId));

  const map = await corpusMapForUser(userId, scope);
  const merged = await fanOutCorpus(map, (t) =>
    t.db
      .select({
        id: schema.invocations.id,
        createdAt: schema.invocations.createdAt,
        operation: schema.invocations.operation,
        activityKind: schema.invocations.activityKind,
        targetExternalId: schema.invocations.targetExternalId,
        sessionId: schema.invocations.sessionId,
        status: schema.invocations.status,
        errorDetail: schema.invocations.errorDetail,
        userPrompt: schema.invocations.userPrompt,
      })
      .from(schema.invocations)
      .where(and(...filters))
      .orderBy(desc(schema.invocations.createdAt))
      .limit(limit),
  );

  const rows = merged
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  return rows.map((r) => ({
    id: r.id,
    ts: r.createdAt,
    actor: r.sessionId ? ("agent" as const) : ("user" as const),
    kind: r.activityKind ?? r.operation,
    operation: r.operation,
    status: r.status,
    targetExternalId: r.targetExternalId,
    sessionId: r.sessionId,
    description: describeActivity({
      kind: r.activityKind,
      operation: r.operation,
      target: r.targetExternalId,
      userPrompt: r.userPrompt,
    }),
    errorDetail: r.errorDetail,
  }));
}

function describeActivity(args: {
  kind: string | null;
  operation: string;
  target: string | null;
  userPrompt: string;
}): string {
  const target = args.target ? ` ${args.target}` : "";
  switch (args.kind) {
    case "draft_proposed":
      return `Draft proposed${target}`;
    case "draft_approved":
      return `Draft approved → document ingested${target}`;
    case "draft_rejected":
      return `Draft rejected${target}`;
    case "draft_archived":
      return `Draft archived${target}`;
    case "document_ingested":
      return `Document ingested${target}`;
    case "document_archived":
      return `Document archived${target}`;
    case "document_linked":
      return `Document link created${target}`;
    case "ticket_progress_set":
      return `Ticket progress updated${target}`;
    case "canon_project_edited":
      return `Project canon edited`;
    case "canon_domain_edited":
      return `Canon domain edited${target}`;
    case "canon_domain_created":
      return `Canon domain created${target}`;
    case "project_domain_assigned":
      return `Project assigned to domain${target}`;
    case "project_created":
      return `Project created${target}`;
    case "project_repo_updated":
      return `Project repo metadata updated`;
    default:
      return args.operation + (target ? ` (${target.trim()})` : "");
  }
}

export async function getDistinctOperations(userId: string, scope: ClientScope): Promise<string[]> {
  const map = await corpusMapForUser(userId, scope);
  const rows = await fanOutCorpus(map, (t) =>
    t.db
      .selectDistinct({ operation: schema.invocations.operation })
      .from(schema.invocations)
      .where(eq(schema.invocations.userId, userId))
      .orderBy(schema.invocations.operation),
  );
  return [...new Set(rows.map((r) => r.operation))].sort();
}
