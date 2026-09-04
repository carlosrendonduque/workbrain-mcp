import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * What these pin: a client's text never reaches an account it was not routed
 * to. Every failure path here is a refusal, because the alternative — falling
 * back to a working provider — would silently break the one promise the
 * dedicated scenario is sold on.
 */

type Mod = typeof import("./providers");
let mod: Mod;

beforeAll(async () => {
  process.env.DATABASE_URL = "postgresql://u:p@central.example.neon.tech/main?sslmode=require";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  mod = await import("./providers");
});

afterEach(() => {
  // `delete`, not `= undefined`: assigning undefined to process.env stores
  // the string "undefined", which reads as a perfectly good credential and
  // makes the refusal tests below pass for the wrong reason.
  delete process.env.ACME_AWS_KEY;
  delete process.env.ACME_AWS_SECRET;
  delete process.env.CLIENT_ANTHROPIC_KEY;
});

function routing(over: Partial<Parameters<Mod["resolveLlm"]>[0]> = {}) {
  return {
    clientSlug: "acme",
    llmProvider: "anthropic",
    llmConfig: {},
    embeddingProvider: "voyage",
    embeddingConfig: {},
    ...over,
  };
}

describe("resolveLlm — anthropic", () => {
  it("uses our account by default", () => {
    const out = mod.resolveLlm(routing());
    expect(out.provider).toBe("anthropic");
    expect(out.destination).toMatch(/our account/);
  });

  it("defaults to a sonnet model", () => {
    expect(mod.resolveLlm(routing()).model).toBe("claude-sonnet-4-6");
  });

  it("honours a model override", () => {
    const out = mod.resolveLlm(routing({ llmConfig: { model: "claude-opus-5" } }));
    expect(out.model).toBe("claude-opus-5");
  });

  it("can read a per-client key from a named env var", () => {
    process.env.CLIENT_ANTHROPIC_KEY = "sk-ant-client";
    expect(() =>
      mod.resolveLlm(routing({ llmConfig: { apiKeyEnv: "CLIENT_ANTHROPIC_KEY" } })),
    ).not.toThrow();
  });

  it("refuses rather than falling back when the named key is absent", () => {
    expect(() => mod.resolveLlm(routing({ llmConfig: { apiKeyEnv: "NOT_SET_ANYWHERE" } }))).toThrow(
      /NOT_SET_ANYWHERE/,
    );
  });
});

describe("resolveLlm — bedrock (the client's own AWS account)", () => {
  const cfg = {
    region: "ap-southeast-2",
    accessKeyIdEnv: "ACME_AWS_KEY",
    secretAccessKeyEnv: "ACME_AWS_SECRET",
  };

  function withCreds() {
    process.env.ACME_AWS_KEY = "AKIAEXAMPLE";
    process.env.ACME_AWS_SECRET = "secret";
  }

  it("routes to Bedrock in the configured region", () => {
    withCreds();
    const out = mod.resolveLlm(routing({ llmProvider: "bedrock", llmConfig: cfg }));
    expect(out.provider).toBe("bedrock");
    expect(out.destination).toContain("ap-southeast-2");
    expect(out.destination).toMatch(/client's own AWS account/);
  });

  it("prefixes the model id the way Bedrock expects", () => {
    withCreds();
    const out = mod.resolveLlm(routing({ llmProvider: "bedrock", llmConfig: cfg }));
    expect(out.model).toBe("anthropic.claude-sonnet-4-6");
  });

  it("does not double-prefix a model that already carries one", () => {
    withCreds();
    const out = mod.resolveLlm(
      routing({
        llmProvider: "bedrock",
        llmConfig: { ...cfg, model: "anthropic.claude-opus-5" },
      }),
    );
    expect(out.model).toBe("anthropic.claude-opus-5");
  });

  // Falling back to our Anthropic account here would send the client's text
  // to a company they never signed anything with. Refusing is the feature.
  it("refuses when the AWS credentials are not in the environment", () => {
    expect(() => mod.resolveLlm(routing({ llmProvider: "bedrock", llmConfig: cfg }))).toThrow(
      /ACME_AWS_KEY/,
    );
  });

  it("refuses a config missing the region", () => {
    withCreds();
    expect(() =>
      mod.resolveLlm(
        routing({
          llmProvider: "bedrock",
          llmConfig: { accessKeyIdEnv: "ACME_AWS_KEY", secretAccessKeyEnv: "ACME_AWS_SECRET" },
        }),
      ),
    ).toThrow(/region/);
  });
});

describe("resolveLlm — providers that are not installed or not known", () => {
  it("refuses vertex rather than quietly using our account", () => {
    expect(() => mod.resolveLlm(routing({ llmProvider: "vertex" }))).toThrow(/not installed/);
  });

  it("refuses foundry the same way", () => {
    expect(() => mod.resolveLlm(routing({ llmProvider: "foundry" }))).toThrow(/not installed/);
  });

  it("refuses an unrecognised provider", () => {
    expect(() => mod.resolveLlm(routing({ llmProvider: "openai" }))).toThrow(/Unknown/);
  });
});

describe("resolveEmbeddings", () => {
  it("uses Voyage by default", () => {
    const out = mod.resolveEmbeddings(routing());
    expect(out.provider).toBe("voyage");
    expect(out.model).toBe("voyage-3-large");
    expect(out.dimensions).toBe(1024);
  });

  it("routes to the client's own Bedrock when configured", () => {
    process.env.ACME_AWS_KEY = "AKIAEXAMPLE";
    process.env.ACME_AWS_SECRET = "secret";
    const out = mod.resolveEmbeddings(
      routing({
        embeddingProvider: "bedrock",
        embeddingConfig: {
          region: "ap-southeast-2",
          accessKeyIdEnv: "ACME_AWS_KEY",
          secretAccessKeyEnv: "ACME_AWS_SECRET",
        },
      }),
    );
    expect(out.provider).toBe("bedrock");
    expect(out.dimensions).toBe(1024);
    expect(out.destination).toMatch(/client's own AWS account/);
  });

  it("defaults Bedrock to Cohere, which batches and is 1024-wide", () => {
    process.env.ACME_AWS_KEY = "AKIAEXAMPLE";
    process.env.ACME_AWS_SECRET = "secret";
    const out = mod.resolveEmbeddings(
      routing({
        embeddingProvider: "bedrock",
        embeddingConfig: {
          region: "ap-southeast-2",
          accessKeyIdEnv: "ACME_AWS_KEY",
          secretAccessKeyEnv: "ACME_AWS_SECRET",
        },
      }),
    );
    expect(out.model).toBe("cohere.embed-english-v3");
  });

  // Embedding runs on every ingest, so a silent fallback here would leak a
  // little of the client's text continuously rather than once.
  it("refuses Bedrock with missing credentials rather than using Voyage", () => {
    expect(() =>
      mod.resolveEmbeddings(
        routing({
          embeddingProvider: "bedrock",
          embeddingConfig: {
            region: "ap-southeast-2",
            accessKeyIdEnv: "ACME_AWS_KEY",
            secretAccessKeyEnv: "ACME_AWS_SECRET",
          },
        }),
      ),
    ).toThrow(/ACME_AWS_KEY/);
  });

  it("refuses vertex embeddings, explaining why the fallback would be wrong", () => {
    expect(() => mod.resolveEmbeddings(routing({ embeddingProvider: "vertex" }))).toThrow(
      /every document/,
    );
  });

  it("refuses an unrecognised provider", () => {
    expect(() => mod.resolveEmbeddings(routing({ embeddingProvider: "openai" }))).toThrow(
      /Unknown/,
    );
  });
});

describe("describeRouting", () => {
  it("reports both destinations for a working client", () => {
    const out = mod.describeRouting(routing());
    expect(out.llm).toMatch(/Anthropic/);
    expect(out.embeddings).toMatch(/Voyage/);
  });

  // The report has to survive a broken client, because a broken client is
  // exactly when someone reads it.
  it("marks a broken provider instead of throwing", () => {
    const out = mod.describeRouting(routing({ llmProvider: "vertex" }));
    expect(out.llm.startsWith("❌")).toBe(true);
    expect(out.embeddings).toMatch(/Voyage/);
  });

  it("marks broken embeddings independently of the llm", () => {
    // Bedrock configured but with no credentials in this environment.
    const out = mod.describeRouting(
      routing({
        embeddingProvider: "bedrock",
        embeddingConfig: {
          region: "ap-southeast-2",
          accessKeyIdEnv: "ACME_AWS_KEY",
          secretAccessKeyEnv: "ACME_AWS_SECRET",
        },
      }),
    );
    expect(out.llm).toMatch(/Anthropic/);
    expect(out.embeddings.startsWith("❌")).toBe(true);
  });
});

describe("routing constants", () => {
  it("keeps the embedding dimensions matching the vector column", () => {
    // The chunks.embedding column is vector(1024). A provider returning a
    // different size would fail on insert with an opaque error.
    expect(mod.EMBEDDING_DIMENSIONS).toBe(1024);
  });
});
