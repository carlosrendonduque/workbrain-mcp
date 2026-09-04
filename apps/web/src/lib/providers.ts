import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import Anthropic from "@anthropic-ai/sdk";
import { schema } from "@workbrain/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  type BedrockEmbeddingOptions,
  defaultModelFor,
  embedViaBedrock,
} from "./bedrock-embeddings";
import type { WorkbrainDb } from "./db";
import { type VoyageInputType, embed as voyageEmbed } from "./embeddings";

/**
 * Which account processes a client's text.
 *
 * This is the second half of the isolation story. Separating the databases
 * answers "where is my data stored"; this answers "who sees it when you work
 * on it" — and that second question is the one a bank's security team asks
 * first, because the answer usually involves a third party they never signed
 * anything with.
 *
 * Routing a client through their own AWS account changes the answer from
 * "trust my contract with Anthropic" to "your contract with AWS, which you
 * already have". That is a much shorter conversation.
 *
 * Same rule as the database connection strings: configuration here holds the
 * NAMES of environment variables, never the credentials themselves.
 */

export class ProviderConfigError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "ProviderConfigError";
    this.code = code;
    this.status = status;
  }
}

/** The routing fields carried on every client row. */
export interface AiRouting {
  clientSlug?: string;
  llmProvider: string;
  llmConfig: unknown;
  embeddingProvider: string;
  embeddingConfig: unknown;
}

function readEnv(name: string, what: string, clientSlug?: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ProviderConfigError(
      "provider_credential_missing",
      `${what} for client ${clientSlug ?? "(unknown)"} reads ${name}, which is not set in this environment. ` +
        "Refusing to fall back to a different account.",
    );
  }
  return value;
}

// ---------------------------------------------------------------- LLM ------

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

const AnthropicLlmConfig = z.object({
  model: z.string().min(1).optional(),
  /** Defaults to ANTHROPIC_API_KEY. */
  apiKeyEnv: z.string().min(1).optional(),
});

const BedrockLlmConfig = z.object({
  region: z.string().min(1),
  /** Names of the env vars holding the CLIENT's AWS credentials. */
  accessKeyIdEnv: z.string().min(1),
  secretAccessKeyEnv: z.string().min(1),
  sessionTokenEnv: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

export interface ResolvedLlm {
  provider: string;
  model: string;
  client: Pick<Anthropic, "messages">;
  /** One line for the isolation report: where this client's text actually goes. */
  destination: string;
}

/** On Bedrock the model id carries an `anthropic.` prefix. */
function bedrockModelId(model: string): string {
  return model.startsWith("anthropic.") ? model : `anthropic.${model}`;
}

export function resolveLlm(client: AiRouting): ResolvedLlm {
  switch (client.llmProvider) {
    case "anthropic": {
      const parsed = AnthropicLlmConfig.safeParse(client.llmConfig ?? {});
      if (!parsed.success) {
        throw new ProviderConfigError(
          "provider_config_invalid",
          `Invalid anthropic llm_config for client ${client.clientSlug ?? "(unknown)"}: ${parsed.error.message}`,
        );
      }
      const apiKey = parsed.data.apiKeyEnv
        ? readEnv(parsed.data.apiKeyEnv, "The Anthropic key", client.clientSlug)
        : undefined;
      return {
        provider: "anthropic",
        model: parsed.data.model ?? DEFAULT_ANTHROPIC_MODEL,
        client: apiKey ? new Anthropic({ apiKey }) : new Anthropic(),
        destination: "Anthropic API (our account)",
      };
    }

    case "bedrock": {
      const parsed = BedrockLlmConfig.safeParse(client.llmConfig ?? {});
      if (!parsed.success) {
        throw new ProviderConfigError(
          "provider_config_invalid",
          `Invalid bedrock llm_config for client ${client.clientSlug ?? "(unknown)"}. ` +
            "It needs region, accessKeyIdEnv and secretAccessKeyEnv. " +
            parsed.error.message,
        );
      }
      const cfg = parsed.data;
      const model = bedrockModelId(cfg.model ?? DEFAULT_ANTHROPIC_MODEL);
      return {
        provider: "bedrock",
        model,
        client: new AnthropicBedrockMantle({
          awsRegion: cfg.region,
          awsAccessKey: readEnv(cfg.accessKeyIdEnv, "The AWS access key", client.clientSlug),
          awsSecretAccessKey: readEnv(
            cfg.secretAccessKeyEnv,
            "The AWS secret key",
            client.clientSlug,
          ),
          awsSessionToken: cfg.sessionTokenEnv
            ? readEnv(cfg.sessionTokenEnv, "The AWS session token", client.clientSlug)
            : undefined,
        }) as unknown as Pick<Anthropic, "messages">,
        destination: `Amazon Bedrock, ${cfg.region} (the client's own AWS account)`,
      };
    }

    case "vertex":
    case "foundry":
      // Declared in the schema and deliberately not installed: the Vertex and
      // Foundry SDKs pull in large auth stacks that nothing currently needs.
      // Failing here is the right outcome — the alternative would be quietly
      // sending the client's text to our own Anthropic account, which is the
      // exact promise this whole mechanism exists to keep.
      throw new ProviderConfigError(
        "provider_not_installed",
        `Client ${client.clientSlug ?? "(unknown)"} is configured for ${client.llmProvider}, ` +
          `which is not installed. Add @anthropic-ai/${client.llmProvider}-sdk and extend resolveLlm. ` +
          "Refusing to fall back to another account.",
      );

    default:
      throw new ProviderConfigError(
        "provider_unknown",
        `Unknown llm_provider "${client.llmProvider}" for client ${client.clientSlug ?? "(unknown)"}.`,
      );
  }
}

// --------------------------------------------------------- Embeddings ------

export const VOYAGE_MODEL = "voyage-3-large";
export const EMBEDDING_DIMENSIONS = 1024;

const VoyageEmbeddingConfig = z.object({
  model: z.string().min(1).optional(),
});

const BedrockEmbeddingConfig = z.object({
  region: z.string().min(1),
  accessKeyIdEnv: z.string().min(1),
  secretAccessKeyEnv: z.string().min(1),
  sessionTokenEnv: z.string().min(1).optional(),
  /** Defaults to Cohere: 1024 dimensions and 96 texts per call. */
  model: z.string().min(1).optional(),
  family: z.enum(["cohere", "titan"]).optional(),
});

export interface ResolvedEmbeddings {
  provider: string;
  /** Recorded on every chunk so a corpus embedded by two models is detectable. */
  model: string;
  dimensions: number;
  embed: (texts: string[], inputType: VoyageInputType) => Promise<number[][]>;
  destination: string;
}

export function resolveEmbeddings(client: AiRouting): ResolvedEmbeddings {
  switch (client.embeddingProvider) {
    case "voyage": {
      const parsed = VoyageEmbeddingConfig.safeParse(client.embeddingConfig ?? {});
      if (!parsed.success) {
        throw new ProviderConfigError(
          "provider_config_invalid",
          `Invalid voyage embedding_config for client ${client.clientSlug ?? "(unknown)"}: ${parsed.error.message}`,
        );
      }
      return {
        provider: "voyage",
        model: parsed.data.model ?? VOYAGE_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        embed: voyageEmbed,
        destination: "Voyage AI (our account)",
      };
    }

    case "bedrock": {
      const parsed = BedrockEmbeddingConfig.safeParse(client.embeddingConfig ?? {});
      if (!parsed.success) {
        throw new ProviderConfigError(
          "provider_config_invalid",
          `Invalid bedrock embedding_config for client ${client.clientSlug ?? "(unknown)"}. ` +
            "It needs region, accessKeyIdEnv and secretAccessKeyEnv. " +
            parsed.error.message,
        );
      }
      const cfg = parsed.data;
      const model = cfg.model ?? defaultModelFor(cfg.family ?? "cohere");
      const opts: BedrockEmbeddingOptions = {
        region: cfg.region,
        accessKeyId: readEnv(cfg.accessKeyIdEnv, "The AWS access key", client.clientSlug),
        secretAccessKey: readEnv(cfg.secretAccessKeyEnv, "The AWS secret key", client.clientSlug),
        ...(cfg.sessionTokenEnv
          ? {
              sessionToken: readEnv(
                cfg.sessionTokenEnv,
                "The AWS session token",
                client.clientSlug,
              ),
            }
          : {}),
        model,
      };
      return {
        provider: "bedrock",
        model,
        dimensions: EMBEDDING_DIMENSIONS,
        embed: (texts, inputType) => embedViaBedrock(texts, inputType, opts),
        destination: `Amazon Bedrock ${model}, ${cfg.region} (the client's own AWS account)`,
      };
    }

    case "vertex":
      // Declared and not installed, same as the Vertex LLM. Falling back to
      // Voyage would send this client's content out through our account on
      // every single document, which is the leak hardest to notice because
      // nobody decides it — it just happens on every ingest.
      throw new ProviderConfigError(
        "embedding_provider_not_implemented",
        `Client ${client.clientSlug ?? "(unknown)"} is configured for vertex embeddings, which is ` +
          "not implemented. Every ingest embeds text, so falling back to Voyage would send this " +
          "client's content through our account on every document. Use bedrock or voyage.",
      );

    default:
      throw new ProviderConfigError(
        "provider_unknown",
        `Unknown embedding_provider "${client.embeddingProvider}" for client ${client.clientSlug ?? "(unknown)"}.`,
      );
  }
}

/**
 * Where a client's text goes, in two lines, for the isolation report.
 *
 * Never throws: a misconfigured client must still show up in the report —
 * that is precisely when you want to read it.
 */
export function describeRouting(client: AiRouting): { llm: string; embeddings: string } {
  const describe = (fn: () => { destination: string }): string => {
    try {
      return fn().destination;
    } catch (err) {
      return `❌ ${err instanceof Error ? err.message.split(".")[0] : "unresolved"}`;
    }
  };
  return {
    llm: describe(() => resolveLlm(client)),
    embeddings: describe(() => resolveEmbeddings(client)),
  };
}

/**
 * Refuse to add vectors from one model to a corpus embedded by another.
 *
 * Cosine distance between vectors from two different models is a number
 * without meaning. Nothing would error, nothing would look wrong, and search
 * would simply start returning the wrong documents for part of the corpus —
 * the worst kind of failure, because it degrades quality invisibly.
 *
 * Called before any write. Changing a client's embedding provider is
 * therefore a deliberate re-index, not something that happens by editing a
 * column.
 */
export async function assertConsistentEmbeddingModel(
  corpusDb: WorkbrainDb,
  projectId: string,
  model: string,
): Promise<void> {
  const existing = await corpusDb
    .selectDistinct({ model: schema.chunks.embeddingModel })
    .from(schema.chunks)
    .where(eq(schema.chunks.projectId, projectId))
    .limit(5);

  // Rows written before the column existed are all voyage-3-large; treat a
  // NULL as that rather than as a conflict.
  const found = new Set(existing.map((r) => r.model ?? VOYAGE_MODEL));
  found.delete(model);
  if (found.size === 0) return;

  throw new ProviderConfigError(
    "embedding_model_conflict",
    `This project's corpus was embedded with ${[...found].join(", ")}, but the client is now ` +
      `configured for ${model}. Vectors from different models are not comparable, so adding ` +
      "these would corrupt search for this project without any visible error. Re-embed the " +
      "existing chunks, or set the provider back.",
    409,
  );
}

/** Which embedding models a project's corpus actually contains. */
export async function embeddingModelsInUse(
  corpusDb: WorkbrainDb,
  projectId: string,
): Promise<string[]> {
  const rows = await corpusDb
    .selectDistinct({ model: schema.chunks.embeddingModel })
    .from(schema.chunks)
    .where(eq(schema.chunks.projectId, projectId));
  return rows.map((r) => r.model ?? VOYAGE_MODEL).sort();
}
