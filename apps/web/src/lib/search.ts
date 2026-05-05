import { and, cosineDistance, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@workbrain/shared";
import { db } from "./db";
import { embed } from "./embeddings";

export const SearchInputSchema = z.object({
  query: z.string().min(1),
  projectSlug: z.string().min(1),
  types: z.array(z.string()).optional(),
  topK: z.number().int().min(1).max(50).optional(),
  minSimilarity: z.number().min(0).max(1).optional(),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

export interface SearchChunk {
  documentId: string;
  documentPath: string;
  documentTitle: string;
  externalId: string | null;
  type: string;
  text: string;
  similarity: number;
}

export interface SearchResult {
  chunks: SearchChunk[];
}

export class SearchError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "SearchError";
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_TOP_K = 8;
const DEFAULT_MIN_SIMILARITY = 0.3;

interface ResolvedProject {
  projectId: string;
}

async function resolveProject(userId: string, projectSlug: string): Promise<ResolvedProject> {
  const rows = await db
    .select({ projectId: schema.projects.id })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.projects.clientId, schema.clients.id))
    .where(and(eq(schema.clients.userId, userId), eq(schema.projects.slug, projectSlug)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new SearchError(
      "project_not_found",
      `Project not found for active user: ${projectSlug}`,
      404,
    );
  }
  return row;
}

async function recordAudit(args: {
  userId: string;
  projectId: string;
  query: string;
  status: "success" | "error";
  retrievedChunks: unknown;
  errorDetail?: string;
  latencyMs: number;
}): Promise<void> {
  try {
    await db.insert(schema.invocations).values({
      userId: args.userId,
      projectId: args.projectId,
      operation: "search",
      userPrompt: args.query,
      retrievedChunks: args.retrievedChunks,
      status: args.status,
      errorDetail: args.errorDetail,
      latencyMs: args.latencyMs,
    });
  } catch (err) {
    console.error("audit insert failed:", err);
  }
}

export async function search(userId: string, input: SearchInput): Promise<SearchResult> {
  const start = Date.now();
  const project = await resolveProject(userId, input.projectSlug);

  const topK = input.topK ?? DEFAULT_TOP_K;
  const minSimilarity = input.minSimilarity ?? DEFAULT_MIN_SIMILARITY;

  try {
    const [queryVec] = await embed([input.query], "query");
    if (!queryVec) {
      throw new SearchError("embedding_failed", "Voyage returned no embedding for query", 500);
    }

    const distance = cosineDistance(schema.chunks.embedding, queryVec);
    const similaritySql = sql<number>`(1 - (${distance}))`;

    const conditions = [
      // SAFETY: project_id filter is mandatory and always present.
      // Cross-project leakage is the worst possible bug for this product.
      eq(schema.chunks.projectId, project.projectId),
      sql`(1 - (${distance})) >= ${minSimilarity}`,
    ];
    if (input.types && input.types.length > 0) {
      conditions.push(inArray(schema.chunks.type, input.types));
    }

    const rows = await db
      .select({
        documentId: schema.chunks.documentId,
        documentPath: schema.documents.path,
        documentTitle: schema.documents.title,
        externalId: schema.documents.externalId,
        type: schema.chunks.type,
        text: schema.chunks.text,
        similarity: similaritySql,
      })
      .from(schema.chunks)
      .innerJoin(schema.documents, eq(schema.chunks.documentId, schema.documents.id))
      .where(and(...conditions))
      .orderBy(desc(similaritySql))
      .limit(topK);

    const chunks: SearchChunk[] = rows.map((r) => ({
      documentId: r.documentId,
      documentPath: r.documentPath,
      documentTitle: r.documentTitle,
      externalId: r.externalId,
      type: r.type,
      text: r.text,
      similarity: Number(r.similarity),
    }));

    await recordAudit({
      userId,
      projectId: project.projectId,
      query: input.query,
      status: "success",
      retrievedChunks: chunks.map((c) => ({
        documentId: c.documentId,
        documentPath: c.documentPath,
        similarity: c.similarity,
      })),
      latencyMs: Date.now() - start,
    });

    return { chunks };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordAudit({
      userId,
      projectId: project.projectId,
      query: input.query,
      status: "error",
      retrievedChunks: [],
      errorDetail: message,
      latencyMs: Date.now() - start,
    });
    throw err;
  }
}
