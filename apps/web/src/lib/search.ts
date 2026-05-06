import { and, cosineDistance, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@workbrain/shared";
import { db } from "./db";
import { type RerankUsage, embed, rerank } from "./embeddings";

export const SearchInputSchema = z.object({
  query: z.string().min(1),
  projectSlug: z.string().min(1),
  types: z.array(z.string()).optional(),
  topK: z.number().int().min(1).max(50).optional(),
  minSimilarity: z.number().min(0).max(1).optional(),
  useRerank: z.boolean().optional(),
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
  rerankScore?: number;
}

export interface SearchResult {
  chunks: SearchChunk[];
  reranked: boolean;
  rerankCostUsd?: string;
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
const DEFAULT_USE_RERANK = true;
// Pull a wider candidate set when reranking so the rerank model can promote
// chunks the bare cosine score ranked lower. Capped to keep rerank cost
// predictable.
const RERANK_CANDIDATE_POOL = 50;
// Voyage rerank-2 list price: $0.05 per 1M tokens.
const RERANK_PRICING_PER_TOKEN = 0.05 / 1_000_000;

function rerankCostUsd(usage: RerankUsage): string {
  return (usage.totalTokens * RERANK_PRICING_PER_TOKEN).toFixed(6);
}

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

interface AuditArgs {
  userId: string;
  projectId: string;
  query: string;
  status: "success" | "error";
  retrievedChunks: unknown;
  errorDetail?: string;
  latencyMs: number;
  rerankUsage?: RerankUsage;
  rerankCost?: string;
}

async function recordAudit(args: AuditArgs): Promise<void> {
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
      provider: args.rerankUsage ? "voyage" : "none",
      model: args.rerankUsage ? "rerank-2" : "none",
      promptTokens: args.rerankUsage?.totalTokens ?? null,
      costUsd: args.rerankCost ?? null,
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
  const useRerank = input.useRerank ?? DEFAULT_USE_RERANK;
  // When reranking, pull a wider pool from the cosine ANN pass so the rerank
  // model has more candidates to choose from. Cosine ranks lexically-adjacent
  // chunks similarly; the reranker is the layer that resolves semantic ties.
  const cosineLimit = useRerank ? Math.max(topK, RERANK_CANDIDATE_POOL) : topK;

  let rerankUsage: RerankUsage | undefined;
  let rerankCost: string | undefined;

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
      .limit(cosineLimit);

    const candidates: SearchChunk[] = rows.map((r) => ({
      documentId: r.documentId,
      documentPath: r.documentPath,
      documentTitle: r.documentTitle,
      externalId: r.externalId,
      type: r.type,
      text: r.text,
      similarity: Number(r.similarity),
    }));

    let chunks: SearchChunk[];
    if (useRerank && candidates.length > 1) {
      const out = await rerank(
        input.query,
        candidates.map((c) => c.text),
        topK,
      );
      rerankUsage = out.usage;
      rerankCost = rerankCostUsd(out.usage);
      chunks = out.hits.map((hit) => {
        const candidate = candidates[hit.index];
        if (!candidate) {
          throw new SearchError(
            "rerank_index_out_of_range",
            `Rerank returned index ${hit.index} but only ${candidates.length} candidates were submitted.`,
            500,
          );
        }
        return { ...candidate, rerankScore: hit.relevanceScore };
      });
    } else {
      chunks = candidates.slice(0, topK);
    }

    await recordAudit({
      userId,
      projectId: project.projectId,
      query: input.query,
      status: "success",
      retrievedChunks: chunks.map((c) => ({
        documentId: c.documentId,
        documentPath: c.documentPath,
        similarity: c.similarity,
        rerankScore: c.rerankScore,
      })),
      latencyMs: Date.now() - start,
      rerankUsage,
      rerankCost,
    });

    return {
      chunks,
      reranked: useRerank && candidates.length > 1,
      rerankCostUsd: rerankCost,
    };
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
      rerankUsage,
      rerankCost,
    });
    throw err;
  }
}
