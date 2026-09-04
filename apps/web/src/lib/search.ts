import { and, cosineDistance, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@workbrain/shared";
import { type InvocationMeta, recordInvocation } from "./audit";
import { ARCHIVED_STATUS } from "./curation";
import type { WorkbrainDb } from "./db";
import { type RerankUsage, embed, rerank } from "./embeddings";
import { TenancyError, resolveProjectContext } from "./tenancy";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z.string().regex(ISO_DATE_PATTERN, "Date must be YYYY-MM-DD");

export const SearchInputSchema = z.object({
  query: z.string().min(1),
  projectSlug: z.string().min(1),
  types: z.array(z.string()).optional(),
  externalId: z.string().min(1).optional(),
  dateRange: z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
    })
    .refine((r) => r.from !== undefined || r.to !== undefined, {
      message: "dateRange must have at least one of from / to",
    })
    .optional(),
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

/**
 * Build the chunk-retrieval query.
 *
 * Extracted so the one invariant that matters can be tested without a
 * database: whatever combination of optional filters a caller passes, the
 * generated SQL still restricts to a single project_id. Cross-client leakage
 * is the worst possible bug in this product, and until this existed the only
 * thing standing between it and a careless refactor was a comment.
 *
 * Tests render this through `.toSQL()`, so they exercise the query the
 * application actually runs rather than a copy of it.
 */
export function buildChunkQuery(args: {
  corpusDb: WorkbrainDb;
  projectId: string;
  queryVec: number[];
  minSimilarity: number;
  limit: number;
  input: Pick<SearchInput, "types" | "externalId" | "dateRange">;
}) {
  const { corpusDb, projectId, queryVec, minSimilarity, limit, input } = args;

  const distance = cosineDistance(schema.chunks.embedding, queryVec);
  const similaritySql = sql<number>`(1 - (${distance}))`;

  const archivedFilter = or(
    isNull(schema.documents.status),
    ne(schema.documents.status, ARCHIVED_STATUS),
  );
  const conditions = [
    // SAFETY: the project_id filter is mandatory and always first. Nothing
    // below is allowed to be conditional on it.
    eq(schema.chunks.projectId, projectId),
    sql`(1 - (${distance})) >= ${minSimilarity}`,
  ];
  if (archivedFilter) conditions.push(archivedFilter);
  if (input.types && input.types.length > 0) {
    conditions.push(inArray(schema.chunks.type, input.types));
  }
  if (input.externalId) {
    conditions.push(eq(schema.documents.externalId, input.externalId));
  }
  if (input.dateRange?.from) {
    conditions.push(gte(schema.documents.createdAt, new Date(input.dateRange.from)));
  }
  if (input.dateRange?.to) {
    // Treat the "to" bound as inclusive end-of-day so 2026-05-06 covers
    // documents ingested at any time on May 6.
    const endOfDay = new Date(`${input.dateRange.to}T23:59:59.999Z`);
    conditions.push(lte(schema.documents.createdAt, endOfDay));
  }

  return corpusDb
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
    .limit(limit);
}

export async function search(
  userId: string,
  input: SearchInput,
  meta: InvocationMeta,
): Promise<SearchResult> {
  const start = Date.now();
  // Resolving the project also resolves which database holds its corpus.
  // Every read below goes through that handle, never the central one.
  // Tenancy failures are re-thrown as SearchError so the API contract
  // (project_not_found -> 404) is unchanged.
  const project = await resolveProjectContext(userId, input.projectSlug, meta.clientScope).catch(
    (err: unknown) => {
      if (err instanceof TenancyError) throw new SearchError(err.code, err.message, err.status);
      throw err;
    },
  );
  const corpusDb = project.corpusDb;

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

    const rows = await buildChunkQuery({
      corpusDb,
      projectId: project.projectId,
      queryVec,
      minSimilarity,
      limit: cosineLimit,
      input,
    });

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

    await recordInvocation({
      corpusDb,
      userId,
      projectId: project.projectId,
      operation: "search",
      sessionId: meta.sessionId,
      targetExternalId: input.externalId ?? null,
      status: "success",
      userPrompt: input.query,
      retrievedChunks: chunks.map((c) => ({
        documentId: c.documentId,
        documentPath: c.documentPath,
        similarity: c.similarity,
        rerankScore: c.rerankScore,
      })),
      latencyMs: Date.now() - start,
      provider: rerankUsage ? "voyage" : "none",
      model: rerankUsage ? "rerank-2" : "none",
      promptTokens: rerankUsage?.totalTokens ?? null,
      costUsd: rerankCost ?? null,
    });

    return {
      chunks,
      reranked: useRerank && candidates.length > 1,
      rerankCostUsd: rerankCost,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordInvocation({
      corpusDb,
      userId,
      projectId: project.projectId,
      operation: "search",
      sessionId: meta.sessionId,
      targetExternalId: input.externalId ?? null,
      status: "error",
      userPrompt: input.query,
      retrievedChunks: [],
      errorDetail: message,
      latencyMs: Date.now() - start,
      provider: rerankUsage ? "voyage" : "none",
      model: rerankUsage ? "rerank-2" : "none",
      promptTokens: rerankUsage?.totalTokens ?? null,
      costUsd: rerankCost ?? null,
    });
    throw err;
  }
}
