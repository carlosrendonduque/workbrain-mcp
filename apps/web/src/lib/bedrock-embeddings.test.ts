import { describe, expect, it, vi } from "vitest";
import {
  BedrockEmbeddingError,
  type BedrockLike,
  assertDimensions,
  batchSizeFor,
  buildRequestBody,
  cohereInputType,
  defaultModelFor,
  embedViaBedrock,
  isTitanModel,
} from "./bedrock-embeddings";

const COHERE = "cohere.embed-english-v3";
const TITAN = "amazon.titan-embed-text-v2:0";

function vector(fill = 0.1): number[] {
  return new Array(1024).fill(fill);
}

describe("model family", () => {
  it("recognises Titan", () => {
    expect(isTitanModel(TITAN)).toBe(true);
    expect(isTitanModel(COHERE)).toBe(false);
  });

  it("defaults to Cohere, which batches", () => {
    expect(defaultModelFor("cohere")).toBe(COHERE);
    expect(batchSizeFor(defaultModelFor("cohere"))).toBe(96);
  });

  // Titan takes one text per call, so a 200-chunk document is 200 round
  // trips. Pinned so nobody assumes batching where there is none.
  it("batches Titan one at a time", () => {
    expect(batchSizeFor(TITAN)).toBe(1);
  });
});

describe("cohereInputType", () => {
  // Cohere produces different vectors for the corpus side and the query
  // side. Getting this backwards degrades retrieval with no error.
  it("maps a query to search_query", () => {
    expect(cohereInputType("query")).toBe("search_query");
  });

  it("maps a document to search_document", () => {
    expect(cohereInputType("document")).toBe("search_document");
  });
});

describe("buildRequestBody — cohere", () => {
  it("sends the texts and the input type", () => {
    const body = JSON.parse(buildRequestBody(COHERE, ["a", "b"], "document"));
    expect(body.texts).toEqual(["a", "b"]);
    expect(body.input_type).toBe("search_document");
  });

  it("truncates the tail rather than failing on one long chunk", () => {
    expect(JSON.parse(buildRequestBody(COHERE, ["a"], "document")).truncate).toBe("END");
  });

  // Asking for embedding_types turns `embeddings` from an array into an
  // object keyed by type, which the parser does not expect.
  it("does not ask for embedding_types", () => {
    expect(JSON.parse(buildRequestBody(COHERE, ["a"], "document")).embedding_types).toBeUndefined();
  });
});

describe("buildRequestBody — titan", () => {
  it("sends one text with explicit dimensions", () => {
    const body = JSON.parse(buildRequestBody(TITAN, ["only"], "document"));
    expect(body.inputText).toBe("only");
    expect(body.dimensions).toBe(1024);
    expect(body.normalize).toBe(true);
  });

  it("refuses to be handed a batch", () => {
    expect(() => buildRequestBody(TITAN, ["a", "b"], "document")).toThrow(BedrockEmbeddingError);
  });
});

describe("assertDimensions", () => {
  it("accepts 1024-wide vectors", () => {
    expect(() => assertDimensions([vector(), vector()], COHERE)).not.toThrow();
  });

  // Postgres would reject these too, but halfway through an ingest and with
  // an error that says nothing about the model's configuration.
  it("rejects a vector of the wrong width, naming the column's expectation", () => {
    expect(() => assertDimensions([new Array(512).fill(0)], COHERE)).toThrow(/1024/);
  });

  it("rejects when only one vector in the batch is wrong", () => {
    expect(() => assertDimensions([vector(), new Array(256).fill(0)], COHERE)).toThrow(
      /dimension/i,
    );
  });
});

function fakeClient(bodies: unknown[]): { client: BedrockLike; sent: string[] } {
  const sent: string[] = [];
  let call = 0;
  const client: BedrockLike = {
    send: vi.fn(async (command: { input?: { body?: string; modelId?: string } }) => {
      sent.push(String(command.input?.body));
      const payload = bodies[Math.min(call, bodies.length - 1)];
      call += 1;
      return { body: new TextEncoder().encode(JSON.stringify(payload)) };
    }) as unknown as BedrockLike["send"],
  };
  return { client, sent };
}

function opts(model: string, client: BedrockLike) {
  return {
    region: "ap-southeast-2",
    accessKeyId: "AKIA",
    secretAccessKey: "secret",
    model,
    clientFactory: () => client,
  };
}

describe("embedViaBedrock", () => {
  it("returns nothing without calling AWS when there is nothing to embed", async () => {
    const { client, sent } = fakeClient([]);
    expect(await embedViaBedrock([], "document", opts(COHERE, client))).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it("embeds a cohere batch in one call", async () => {
    const { client, sent } = fakeClient([{ embeddings: [vector(), vector()] }]);
    const out = await embedViaBedrock(["a", "b"], "document", opts(COHERE, client));
    expect(out).toHaveLength(2);
    expect(sent).toHaveLength(1);
  });

  it("splits past cohere's 96-text limit", async () => {
    const texts = new Array(100).fill("x");
    const { client, sent } = fakeClient([
      { embeddings: new Array(96).fill(vector()) },
      { embeddings: new Array(4).fill(vector()) },
    ]);
    const out = await embedViaBedrock(texts, "document", opts(COHERE, client));
    expect(out).toHaveLength(100);
    expect(sent).toHaveLength(2);
  });

  it("calls Titan once per text", async () => {
    const { client, sent } = fakeClient([{ embedding: vector() }]);
    const out = await embedViaBedrock(["a", "b", "c"], "document", opts(TITAN, client));
    expect(out).toHaveLength(3);
    expect(sent).toHaveLength(3);
  });

  it("keeps the order of the texts it was given", async () => {
    const { client } = fakeClient([{ embeddings: [vector(0.1), vector(0.2)] }]);
    const out = await embedViaBedrock(["a", "b"], "document", opts(COHERE, client));
    expect(out[0]?.[0]).toBe(0.1);
    expect(out[1]?.[0]).toBe(0.2);
  });

  // Silently returning fewer vectors than texts would misalign every chunk
  // after the gap with the wrong embedding.
  it("fails when fewer vectors come back than texts sent", async () => {
    const { client } = fakeClient([{ embeddings: [vector()] }]);
    await expect(embedViaBedrock(["a", "b"], "document", opts(COHERE, client))).rejects.toThrow(
      /got 1 vector/,
    );
  });

  it("fails on a response with no embeddings field", async () => {
    const { client } = fakeClient([{ nope: true }]);
    await expect(embedViaBedrock(["a"], "document", opts(COHERE, client))).rejects.toThrow(
      /did not contain an embeddings array/,
    );
  });

  it("fails on wrong-width vectors rather than passing them to Postgres", async () => {
    const { client } = fakeClient([{ embeddings: [new Array(512).fill(0)] }]);
    await expect(embedViaBedrock(["a"], "document", opts(COHERE, client))).rejects.toThrow(/1024/);
  });

  it("sends search_query for a query", async () => {
    const { client, sent } = fakeClient([{ embeddings: [vector()] }]);
    await embedViaBedrock(["q"], "query", opts(COHERE, client));
    expect(JSON.parse(String(sent[0])).input_type).toBe("search_query");
  });
});
