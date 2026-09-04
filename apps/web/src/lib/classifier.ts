// Auto-classifier for pasted documents (Phase 2 — Task 2.1).
//
// Single LLM call against Claude Sonnet 4.6 with tool use for structured
// output. Thinking is disabled and effort is set to "low" — classification
// is a simple, latency-sensitive task. The system prompt and tool definition
// are cached via cache_control: ephemeral so consecutive ingests inside a
// single 5-minute window pay the cache_read price (~10% of base) for the
// stable prefix.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

// Default only. Each client's provider decides the real model — on Bedrock
// the same model carries an `anthropic.` prefix — so callers pass it in.
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;

export const DOCUMENT_TYPES = [
  "ticket",
  "confluence",
  "teams_thread",
  "email",
  "transcript",
  "decision",
  "convention",
  "guideline",
  "stakeholder",
  "task",
  "note",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

const ResultSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  externalId: z.string().min(1).optional(),
  references: z.array(z.string().min(1)).default([]),
  detectedDate: z.string().optional(),
  reasoning: z.string().optional(),
});

export type ClassifierResult = z.infer<typeof ResultSchema>;

export interface ClassifierUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface ClassifierOutput {
  result: ClassifierResult;
  usage: ClassifierUsage;
  model: string;
  latencyMs: number;
}

export class ClassifierError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ClassifierError";
    this.code = code;
    this.status = status;
  }
}

const SYSTEM_PROMPT = `You are a document classifier inside WorkBrain, a multi-client project memory layer for a software consultant.

Pasted documents arrive from many sources (Jira, ServiceNow, Confluence, Teams, Outlook, meeting transcripts, ad-hoc notes). Your job is to:

1. Identify the document type from a fixed taxonomy (see the tool schema).
2. Extract the document's external identifier when one is clearly present (e.g. "TICKET-1234", "CASE-9876", "INC0042"). Only extract IDs that look like primary identifiers for this document — do NOT extract IDs that are merely mentioned in the body. If the document does not have its own external ID, omit the field.
3. Extract any other external IDs that are referenced in the body (e.g. "blocked by TICKET-9999", "see CASE-1111"). Return them in references[]. Do NOT include the document's own externalId in references.
4. Optionally extract a primary date in ISO 8601 (YYYY-MM-DD) when the document clearly carries one (created/sent date for emails, posted date for Teams threads, ticket created date, meeting date for transcripts).
5. Provide a one-sentence reasoning for your classification choice.

Type taxonomy:
- ticket: Jira/ServiceNow/Salesforce-style support or work tickets with a status, assignee, comments thread.
- confluence: Long-form documentation pages from Confluence, SharePoint, Notion, Wiki.
- teams_thread: Microsoft Teams chat threads (typically multiple messages, channel/group context).
- email: Outlook / Gmail email (From, To, Subject, body).
- transcript: Meeting transcript (Teams, Zoom, etc.) with speaker labels and timestamps.
- decision: Architectural Decision Record (ADR) or short technical decision note.
- convention: Project convention or coding standard.
- guideline: Best practice document.
- stakeholder: A person profile or stakeholder description (role, communication style).
- task: Generic todo or work item that is not a tracked ticket.
- note: Free-form note that does not fit any of the above.

Always call the classify_document tool once. Never reply with prose.`;

const TOOL: Anthropic.Tool = {
  name: "classify_document",
  description: "Classify the pasted document and extract structured metadata.",
  input_schema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [...DOCUMENT_TYPES],
        description: "Document type from the fixed taxonomy.",
      },
      externalId: {
        type: "string",
        description:
          "Primary external identifier for this document (e.g. TICKET-1234). Omit if the document has no clear primary ID.",
      },
      references: {
        type: "array",
        items: { type: "string" },
        description:
          "External IDs (tickets, cases, incidents) referenced in the body. Do not include the document's own externalId.",
      },
      detectedDate: {
        type: "string",
        description: "Primary date associated with the document, in YYYY-MM-DD format.",
      },
      reasoning: {
        type: "string",
        description: "One short sentence explaining the classification.",
      },
    },
    required: ["type", "references"],
  },
};

export interface ClassifyOptions {
  /**
   * The client to send this through. Comes from resolveLlm(), which decides
   * whether the text goes to our Anthropic account or the client's own cloud
   * account. Typed structurally because the Bedrock client is a different
   * class with the same messages surface.
   */
  client?: Pick<Anthropic, "messages">;
  /** Model id for that provider — Bedrock ids differ from first-party ones. */
  model?: string;
}

export async function classify(
  rawText: string,
  options: ClassifyOptions = {},
): Promise<ClassifierOutput> {
  if (rawText.trim().length === 0) {
    throw new ClassifierError("empty_input", "Document text is empty.", 400);
  }

  const client = options.client ?? new Anthropic();
  const model = options.model ?? MODEL;
  const start = Date.now();

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "classify_document" },
      messages: [
        {
          role: "user",
          content: `Document to classify:\n\n${rawText}`,
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new ClassifierError("rate_limited", err.message, 429, err);
    }
    if (err instanceof Anthropic.AuthenticationError) {
      throw new ClassifierError("auth_failed", err.message, 401, err);
    }
    if (err instanceof Anthropic.APIError) {
      throw new ClassifierError("anthropic_api_error", err.message, err.status ?? 500, err);
    }
    throw new ClassifierError(
      "unknown_error",
      err instanceof Error ? err.message : String(err),
      500,
      err,
    );
  }

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "classify_document",
  );
  if (!block) {
    throw new ClassifierError(
      "no_tool_call",
      "Classifier did not call classify_document. Stop reason: " + response.stop_reason,
      500,
    );
  }

  const parsed = ResultSchema.safeParse(block.input);
  if (!parsed.success) {
    throw new ClassifierError(
      "malformed_tool_input",
      "Classifier returned an input that did not match the schema.",
      500,
      parsed.error,
    );
  }

  return {
    result: parsed.data,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
    model: response.model,
    latencyMs: Date.now() - start,
  };
}
