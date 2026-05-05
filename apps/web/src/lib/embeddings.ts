import { z } from "zod";

const ENDPOINT = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3-large";
const MAX_BATCH = 128;
const MAX_RETRIES = 3;
const EXPECTED_DIMENSIONS = 1024;

export type VoyageInputType = "document" | "query";

export class VoyageError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "VoyageError";
    this.status = status;
    this.body = body;
  }
}

const VoyageResponseSchema = z.object({
  data: z.array(
    z.object({
      embedding: z.array(z.number()),
      index: z.number().int(),
    }),
  ),
  model: z.string().optional(),
  usage: z
    .object({
      total_tokens: z.number().int(),
    })
    .optional(),
});

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function embedBatch(
  texts: string[],
  inputType: VoyageInputType,
  apiKey: string,
): Promise<number[][]> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: texts,
        model: MODEL,
        input_type: inputType,
      }),
    });

    if (response.ok) {
      const json = await response.json();
      const parsed = VoyageResponseSchema.parse(json);
      return parsed.data
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((entry) => entry.embedding);
    }

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const backoffMs = 2 ** attempt * 1000;
      await sleep(backoffMs);
      continue;
    }

    const body = await readBody(response);
    throw new VoyageError(
      `Voyage API ${response.status}: ${response.statusText}`,
      response.status,
      body,
    );
  }

  throw new VoyageError("Voyage API exceeded retry budget", 0, null);
}

export async function embed(texts: string[], inputType: VoyageInputType): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY is not set");
  }

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const slice = texts.slice(i, i + MAX_BATCH);
    const batch = await embedBatch(slice, inputType, apiKey);
    out.push(...batch);
  }
  return out;
}

export const __internals = { EXPECTED_DIMENSIONS, MODEL, ENDPOINT };
