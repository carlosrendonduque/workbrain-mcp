import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import type { VoyageInputType } from "./embeddings";

/**
 * Embeddings through a client's own AWS account.
 *
 * This is the half that makes the dedicated scenario true rather than nearly
 * true. Routing the language model to the client's Bedrock while their text
 * still goes to our Voyage account on every ingest would leave the promise
 * false in the place it is hardest to notice — embedding is not a decision
 * anyone makes, it just happens on every document.
 *
 * Two models, because which one a client can use is decided by what they have
 * enabled in their account, not by us:
 *
 *   cohere    1024 dimensions, up to 96 texts per call, and a native
 *             document/query distinction that matches how this corpus is
 *             searched. The default, and the one to ask for.
 *   titan     1024 dimensions, but ONE text per call. A 200-chunk document
 *             becomes 200 round trips. Supported because some accounts only
 *             have Titan enabled; slow enough that it should not be a choice
 *             made casually.
 *
 * Both return 1024 floats, which is what the chunks.embedding column holds.
 * A model returning anything else is rejected rather than written.
 */

export const EMBEDDING_DIMENSIONS = 1024;

// Cohere accepts 96 texts per call. Titan accepts one, so its "batch" is 1.
const COHERE_MAX_BATCH = 96;
const DEFAULT_COHERE_MODEL = "cohere.embed-english-v3";
const DEFAULT_TITAN_MODEL = "amazon.titan-embed-text-v2:0";

export class BedrockEmbeddingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BedrockEmbeddingError";
    this.code = code;
  }
}

export interface BedrockEmbeddingOptions {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  model: string;
  /** Injected in tests; production uses the real client. */
  clientFactory?: (opts: BedrockEmbeddingOptions) => BedrockLike;
}

/** The slice of the AWS client this module uses. */
export interface BedrockLike {
  send: (command: InvokeModelCommand) => Promise<{ body?: Uint8Array }>;
}

export function isTitanModel(model: string): boolean {
  return model.startsWith("amazon.titan-embed");
}

export function defaultModelFor(family: "cohere" | "titan"): string {
  return family === "titan" ? DEFAULT_TITAN_MODEL : DEFAULT_COHERE_MODEL;
}

export function batchSizeFor(model: string): number {
  return isTitanModel(model) ? 1 : COHERE_MAX_BATCH;
}

/**
 * Cohere distinguishes the corpus side from the query side and the vectors
 * differ accordingly, so getting this backwards degrades retrieval quietly.
 */
export function cohereInputType(inputType: VoyageInputType): string {
  return inputType === "query" ? "search_query" : "search_document";
}

// `embedding_types` is deliberately not sent: asking for it changes
// `embeddings` from an array into an object keyed by type, and the simple
// array is what we want.
const CohereResponse = z.object({
  embeddings: z.array(z.array(z.number())),
});

const TitanResponse = z.object({
  embedding: z.array(z.number()),
});

export function buildRequestBody(
  model: string,
  texts: string[],
  inputType: VoyageInputType,
): string {
  if (isTitanModel(model)) {
    const only = texts[0];
    if (texts.length !== 1 || only === undefined) {
      throw new BedrockEmbeddingError(
        "titan_batch_unsupported",
        `Titan embeds one text per call; got ${texts.length}.`,
      );
    }
    return JSON.stringify({
      inputText: only,
      dimensions: EMBEDDING_DIMENSIONS,
      normalize: true,
    });
  }
  return JSON.stringify({
    texts,
    input_type: cohereInputType(inputType),
    // Chunks are already sized well under the limit; truncating the tail is
    // better than failing an ingest on one oversized chunk.
    truncate: "END",
  });
}

export function parseResponseBody(model: string, raw: string): number[][] {
  const json: unknown = JSON.parse(raw);

  if (isTitanModel(model)) {
    const parsed = TitanResponse.safeParse(json);
    if (!parsed.success) {
      throw new BedrockEmbeddingError(
        "unexpected_response",
        `Titan response did not contain an embedding array: ${parsed.error.message}`,
      );
    }
    return [parsed.data.embedding];
  }

  const parsed = CohereResponse.safeParse(json);
  if (!parsed.success) {
    throw new BedrockEmbeddingError(
      "unexpected_response",
      `Cohere response did not contain an embeddings array: ${parsed.error.message}`,
    );
  }
  return parsed.data.embeddings;
}

/**
 * Reject a vector of the wrong width here rather than letting Postgres do it.
 * The column is vector(1024); a mismatch there surfaces as an opaque insert
 * error halfway through an ingest, with no indication that the cause was a
 * model configured with different dimensions.
 */
export function assertDimensions(vectors: number[][], model: string): void {
  for (const vector of vectors) {
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new BedrockEmbeddingError(
        "dimension_mismatch",
        `${model} returned ${vector.length}-dimension vectors, but chunks.embedding holds ` +
          `${EMBEDDING_DIMENSIONS}. Use a model configured for ${EMBEDDING_DIMENSIONS} dimensions.`,
      );
    }
  }
}

function realClient(opts: BedrockEmbeddingOptions): BedrockLike {
  return new BedrockRuntimeClient({
    region: opts.region,
    credentials: {
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      ...(opts.sessionToken ? { sessionToken: opts.sessionToken } : {}),
    },
  }) as unknown as BedrockLike;
}

/** Embed texts through the client's own Bedrock, in the model's batch size. */
export async function embedViaBedrock(
  texts: string[],
  inputType: VoyageInputType,
  opts: BedrockEmbeddingOptions,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = (opts.clientFactory ?? realClient)(opts);
  const batchSize = batchSizeFor(opts.model);
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await client.send(
      new InvokeModelCommand({
        modelId: opts.model,
        contentType: "application/json",
        accept: "application/json",
        body: buildRequestBody(opts.model, batch, inputType),
      }),
    );

    if (!response.body) {
      throw new BedrockEmbeddingError("empty_response", `${opts.model} returned no body.`);
    }
    const vectors = parseResponseBody(opts.model, new TextDecoder().decode(response.body));

    if (vectors.length !== batch.length) {
      throw new BedrockEmbeddingError(
        "count_mismatch",
        `Sent ${batch.length} text(s) to ${opts.model} and got ${vectors.length} vector(s) back.`,
      );
    }
    assertDimensions(vectors, opts.model);
    out.push(...vectors);
  }

  return out;
}
