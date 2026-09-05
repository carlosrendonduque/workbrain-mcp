import { schema } from "@workbrain/shared";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { type InvocationMeta, recordInvocation } from "./audit";
import { getCanonDomainById, type MergedCanon, mergeCanon } from "./canon-domains";
import type { WorkbrainDb } from "./db";
import { approxTokens } from "./chunking";
import { type SearchChunk, search } from "./search";
import {
  type ClientScope,
  type ProjectContext,
  TenancyError,
  resolveProjectContext,
} from "./tenancy";

export const ComposeContextInputSchema = z
  .object({
    projectSlug: z.string().min(1),
    focusExternalId: z.string().min(1).optional(),
    focusText: z.string().min(1).optional(),
    topK: z.number().int().min(1).max(50).optional(),
    minSimilarity: z.number().min(0).max(1).optional(),
    /**
     * Rough ceiling on the size of the returned bundle, in tokens.
     * Everything here lands in the agent's context window, and until this
     * existed a ticket with fifteen linked Confluence pages could fill it in
     * one call — from the tool whose whole job is managing that window.
     */
    maxTokens: z.number().int().min(2000).max(200_000).optional(),
  })
  .refine((d) => Boolean(d.focusExternalId) || Boolean(d.focusText), {
    message: "Provide either focusExternalId or focusText",
  });

export type ComposeContextInput = z.infer<typeof ComposeContextInputSchema>;

export const GetCanonInputSchema = z.object({
  projectSlug: z.string().min(1),
});

export type GetCanonInput = z.infer<typeof GetCanonInputSchema>;

export interface FocusDocument {
  documentId: string;
  path: string;
  title: string;
  type: string;
  externalId: string | null;
  content: string;
  frontmatter: Record<string, unknown>;
}

export interface LinkedDocument {
  documentId: string;
  /**
   * False when the budget ran out before this document. Everything else
   * about it is still here, so the agent knows it exists and can ask for it
   * by external id.
   */
  contentIncluded: boolean;
  type: string;
  externalId: string | null;
  title: string;
  path: string;
  content: string;
  linkType: string;
  note: string | null;
}

export interface StakeholderInScope {
  name: string;
  role: string | null;
  communicationStyle: string | null;
}

export interface ComposeContextResult {
  project: { slug: string; name: string };
  client: { slug: string; name: string };
  canon: {
    conventions: string | null;
    guidelines: string | null;
    architecture: string | null;
    source: {
      conventions: "project" | "domain" | "none";
      guidelines: "project" | "domain" | "none";
      architecture: "project" | "domain" | "none";
    };
    domain: { slug: string; name: string } | null;
  };
  focus: FocusDocument | null;
  linked: Record<string, LinkedDocument[]>;
  ragChunks: SearchChunk[];
  stakeholders: StakeholderInScope[];
  instructionsForAgent: string;
  metadata: {
    focusReason: string;
    chunksRetrieved: number;
    linksFollowed: number;
    rerankUsed: boolean;
    /**
     * What the budget cost. Reported rather than applied silently: an agent
     * given a trimmed view without being told is worse off than one given a
     * smaller view it knows about, because it will reason as though it has
     * seen everything.
     */
    budget: {
      limitTokens: number;
      usedTokens: number;
      linkedDocsOmitted: number;
      ragChunksDropped: number;
      focusTruncated: boolean;
      /** True when the canon alone exceeded the limit. Never trimmed. */
      overBudget: boolean;
    };
  };
}

// The canon-only slice of a compose result: everything that is true for the
// project regardless of which ticket is being worked. This is what an agent
// needs at the top of a conversation, before there is a focus document.
export interface GetCanonResult {
  project: { slug: string; name: string };
  client: { slug: string; name: string };
  canon: ComposeContextResult["canon"];
  stakeholders: StakeholderInScope[];
  instructionsForAgent: string;
}

export class ComposeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ComposeError";
    this.code = code;
    this.status = status;
  }
}

// Group document types into the buckets the brief specifies. Anything
// outside the canonical set lands in "other" so callers always get a
// total typing of the linked map.
const TYPE_BUCKET: Record<string, string> = {
  ticket: "tickets",
  confluence: "confluence",
  teams_thread: "teams",
  email: "emails",
  transcript: "transcripts",
  decision: "decisions",
};

function bucketName(type: string): string {
  return TYPE_BUCKET[type] ?? "other";
}

const FOCUS_QUERY_CHAR_LIMIT = 1500;

// Big enough to be worth loading, small enough to leave the agent room to
// work. Callers with a bigger window can raise it per call.
const DEFAULT_MAX_TOKENS = 40_000;

/**
 * Everything normative the agent was handed, as one blob for the audit row.
 *
 * Design principle 5 asks for the full system prompt to be persisted, and
 * `instructionsForAgent` alone does not satisfy it: it names where the canon
 * came from — project or domain — but never what it says. The conventions
 * ARE the behaviour, so an audit row without them cannot answer the question
 * it exists for.
 *
 * The canon is also the part that changes. Edit a convention and the old
 * wording is gone; without a copy here, invocations from before the edit
 * become unexplainable. Storing it per invocation is redundant on any day
 * nothing changed, and it is the only thing that makes the days something
 * did change legible.
 */
export function governingPrompt(
  instructions: string,
  canon: { conventions: string | null; guidelines: string | null; architecture: string | null },
): string {
  const section = (label: string, body: string | null): string =>
    body && body.trim().length > 0 ? `\n\n## ${label} (in force at this call)\n\n${body}` : "";

  return [
    instructions,
    section("Conventions", canon.conventions),
    section("Guidelines", canon.guidelines),
    section("Architecture", canon.architecture),
  ].join("");
}

/**
 * Tell the agent, in the instructions it actually reads, that its view is
 * partial.
 *
 * The metadata carries the same numbers, but an agent is not obliged to read
 * metadata and will not reason about what it did not notice. Saying it here
 * is what turns a trimmed bundle from a silent handicap into a known one it
 * can work around by asking for the rest.
 */
export function withBudgetNotice(
  instructions: string,
  budget: ComposeContextResult["metadata"]["budget"],
): string {
  const notes: string[] = [];
  if (budget.focusTruncated) {
    notes.push(
      "- The focus document was TRUNCATED to fit. Ask for the rest before relying on it being complete.",
    );
  }
  if (budget.linkedDocsOmitted > 0) {
    notes.push(
      `- ${budget.linkedDocsOmitted} linked document(s) are listed without their content. They exist; fetch one by its external id with compose_context if you need it.`,
    );
  }
  if (budget.ragChunksDropped > 0) {
    notes.push(
      `- ${budget.ragChunksDropped} lower-ranked corpus chunk(s) were dropped. Narrow the query with search if you need more.`,
    );
  }
  if (budget.overBudget) {
    notes.push(
      "- The canon alone exceeds the context budget. It was NOT trimmed — conventions are binding and a half-read rule is worse than none — but everything else had no room. Tell the user their canon needs shortening.",
    );
  }
  if (notes.length === 0) return instructions;

  return `${instructions}

## This bundle is incomplete

${notes.join("\n")}

Do not treat what you were given as the whole picture.`;
}

/**
 * Fit the bundle inside a token budget, and report exactly what that cost.
 *
 * Order matters and reflects what the agent cannot work without:
 *
 *   1. canon      binding rules. NEVER trimmed — a half-read convention is
 *                 worse than none, because the agent will follow the half it
 *                 got and believe it followed all of it.
 *   2. focus      the ticket being worked. Truncated only as a last resort,
 *                 and flagged when it happens.
 *   3. linked     supporting. Dropped whole, keeping the reference, so the
 *                 agent still knows the document exists and can ask for it.
 *   4. rag        supporting. Trimmed from the least relevant end.
 *
 * Nothing is trimmed silently. An agent handed a partial view it does not
 * know is partial will reason as though it saw everything.
 */
export function applyBudget(args: {
  limitTokens: number;
  canonTokens: number;
  instructionsTokens: number;
  focus: FocusDocument | null;
  linked: LinkedDocument[];
  ragChunks: SearchChunk[];
}): {
  focus: FocusDocument | null;
  linked: LinkedDocument[];
  ragChunks: SearchChunk[];
  budget: ComposeContextResult["metadata"]["budget"];
} {
  const { limitTokens, canonTokens, instructionsTokens } = args;
  const fixed = canonTokens + instructionsTokens;

  let focus = args.focus;
  let focusTruncated = false;
  let remaining = limitTokens - fixed;

  // The canon and the instructions alone can exceed the limit. Report it and
  // carry on rather than cutting the rules the agent is bound by; the fix is
  // a shorter canon, and the user needs to be told that.
  const overBudget = remaining <= 0;

  if (focus) {
    const focusTokens = approxTokens(focus.content);
    if (!overBudget && focusTokens > remaining) {
      const keepChars = Math.max(0, remaining * 4);
      focus = {
        ...focus,
        content: `${focus.content.slice(0, keepChars)}\n\n[truncated to fit the context budget]`,
      };
      focusTruncated = true;
      remaining = 0;
    } else {
      remaining -= focusTokens;
    }
  }

  const linked: LinkedDocument[] = [];
  let linkedDocsOmitted = 0;
  for (const doc of args.linked) {
    const cost = approxTokens(doc.content);
    if (remaining - cost >= 0) {
      linked.push({ ...doc, contentIncluded: true });
      remaining -= cost;
    } else {
      // Keep the reference, drop the body.
      linked.push({ ...doc, content: "", contentIncluded: false });
      linkedDocsOmitted += 1;
    }
  }

  const ragChunks: SearchChunk[] = [];
  let ragChunksDropped = 0;
  for (const chunk of args.ragChunks) {
    const cost = approxTokens(chunk.text);
    if (remaining - cost >= 0) {
      ragChunks.push(chunk);
      remaining -= cost;
    } else {
      ragChunksDropped += 1;
    }
  }

  const usedTokens =
    fixed +
    (focus ? approxTokens(focus.content) : 0) +
    linked.reduce((n, d) => n + approxTokens(d.content), 0) +
    ragChunks.reduce((n, c) => n + approxTokens(c.text), 0);

  return {
    focus,
    linked,
    ragChunks,
    budget: {
      limitTokens,
      usedTokens,
      linkedDocsOmitted,
      ragChunksDropped,
      focusTruncated,
      overBudget,
    },
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildInstructions(args: {
  clientName: string;
  projectName: string;
  canonSources: { conventions: string; guidelines: string; architecture: string };
  domain: { slug: string; name: string } | null;
  // "compose" describes a full payload with a focus document and RAG chunks;
  // "canon" describes the canon-only payload get_canon returns. Same rules,
  // different inventory — an agent told to read ragChunks that aren't there
  // has been handed a lie.
  mode: "compose" | "canon";
}): string {
  const domainLabel = args.domain
    ? `domain "${args.domain.name}" (${args.domain.slug})`
    : "no canon domain assigned";

  const sourceLine = (label: string, source: string): string => {
    if (source === "project") return `- ${label}: project-level (specific to ${args.projectName})`;
    if (source === "domain") return `- ${label}: ${domainLabel} (cross-project default)`;
    return `- ${label}: not configured`;
  };

  const inventory =
    args.mode === "compose"
      ? `- The active client and project, plus the merged canon (conventions, guidelines, architecture).
- The current focus document (if any) with its frontmatter and full content.
- Other documents explicitly linked from the focus, grouped by type.
- Relevant chunks retrieved from the corpus by semantic similarity (RAG, reranked when possible).
- Stakeholders for this project with their communication preferences.`
      : `- The active client and project, plus the merged canon (conventions, guidelines, architecture).
- Stakeholders for this project with their communication preferences.

This is the canon only — no focus document and no corpus chunks were retrieved. Read the canon before proposing anything, then call compose_context with a ticket's externalId once you know which ticket you are working on.`;

  const closing =
    args.mode === "compose"
      ? `

ragChunks are sorted by relevance (rerankScore when present, similarity otherwise). The focus document is the primary subject — start there, then layer in linked documents and ragChunks as supporting context.`
      : "";

  return `You are working inside WorkBrain. The structured payload above gives you:
${inventory}

Active client: ${args.clientName}
Active project: ${args.projectName}
Canon domain: ${domainLabel}

Canon layering (project overrides domain-level where they conflict):
${sourceLine("Conventions", args.canonSources.conventions)}
${sourceLine("Guidelines", args.canonSources.guidelines)}
${sourceLine("Architecture", args.canonSources.architecture)}

Inviolable rules:
1. Stay within ${args.clientName}. Do NOT mention or reuse information from any other client, not even as analogies ("in another project we saw X"). Each client is an architecturally guaranteed silo. Domain-level canon is allowed because it's the user's own cross-project conventions for this practice area, not another client's data.
2. If a recommendation conflicts with the canon above (project or domain), explicitly flag the conflict and ask the user to confirm before applying. Do not improvise against the canon.
3. If the retrieved context is insufficient to answer, say so. Do not fabricate stakeholders, decisions, or conventions that are not in the corpus.
4. When citing a ticket or document, use its external_id (e.g. TICKET-1234).
5. For drafts directed at stakeholders, respect the indicated communication_style. Do not improvise tone.${closing}`;
}

// The project plus the database holding its corpus. Tenancy failures are
// re-thrown as ComposeError so the API contract (project_not_found -> 404)
// is unchanged.
async function resolveProject(
  userId: string,
  projectSlug: string,
  scope: ClientScope,
): Promise<ProjectContext> {
  try {
    return await resolveProjectContext(userId, projectSlug, scope);
  } catch (err) {
    if (err instanceof TenancyError) throw new ComposeError(err.code, err.message, err.status);
    throw err;
  }
}

async function loadFocus(
  corpusDb: WorkbrainDb,
  projectId: string,
  externalId: string,
): Promise<FocusDocument | null> {
  const rows = await corpusDb
    .select({
      documentId: schema.documents.id,
      path: schema.documents.path,
      title: schema.documents.title,
      type: schema.documents.type,
      externalId: schema.documents.externalId,
      content: schema.documents.content,
      frontmatter: schema.documents.frontmatter,
    })
    .from(schema.documents)
    .where(
      and(eq(schema.documents.projectId, projectId), eq(schema.documents.externalId, externalId)),
    )
    // A unique index now makes more than one row impossible, so this orders
    // a set of at most one. It stays as the safety net for any database that
    // predates that index: without it, `limit(1)` returns whichever row
    // Postgres felt like, which could be the older version of the ticket.
    .orderBy(desc(schema.documents.updatedAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    documentId: row.documentId,
    path: row.path,
    title: row.title,
    type: row.type,
    externalId: row.externalId,
    content: row.content,
    frontmatter: isObjectRecord(row.frontmatter) ? row.frontmatter : {},
  };
}

async function loadLinkedDocuments(
  corpusDb: WorkbrainDb,
  focusId: string,
): Promise<LinkedDocument[]> {
  const rows = await corpusDb
    .select({
      documentId: schema.documents.id,
      type: schema.documents.type,
      externalId: schema.documents.externalId,
      title: schema.documents.title,
      path: schema.documents.path,
      content: schema.documents.content,
      linkType: schema.documentLinks.linkType,
      note: schema.documentLinks.note,
    })
    .from(schema.documentLinks)
    .innerJoin(schema.documents, eq(schema.documentLinks.toDocumentId, schema.documents.id))
    .where(eq(schema.documentLinks.fromDocumentId, focusId));
  // applyBudget decides which of these keep their content.
  return rows.map((r) => ({ ...r, contentIncluded: true }));
}

async function loadStakeholders(
  corpusDb: WorkbrainDb,
  projectId: string,
): Promise<StakeholderInScope[]> {
  const rows = await corpusDb
    .select({
      name: schema.stakeholders.name,
      role: schema.stakeholders.role,
      communicationStyle: schema.stakeholders.communicationStyle,
    })
    .from(schema.stakeholders)
    .where(eq(schema.stakeholders.projectId, projectId));
  return rows;
}

// Everything that depends only on the project, not on the focus document.
// Shared by composeContext and getCanon so both return an identical canon
// block and an identical instructions preamble.
async function loadCanonBundle(
  userId: string,
  project: ProjectContext,
  mode: "compose" | "canon",
): Promise<{
  mergedCanon: MergedCanon;
  stakeholders: StakeholderInScope[];
  instructionsForAgent: string;
}> {
  const stakeholders = await loadStakeholders(project.corpusDb, project.projectId);
  const domainCanon = project.domainId ? await getCanonDomainById(userId, project.domainId) : null;
  const mergedCanon = mergeCanon(
    {
      conventions: project.conventions,
      guidelines: project.guidelines,
      architecture: project.architecture,
    },
    domainCanon,
  );
  const instructionsForAgent = buildInstructions({
    clientName: project.clientName,
    projectName: project.projectName,
    canonSources: mergedCanon.source,
    domain: mergedCanon.domain,
    mode,
  });
  return { mergedCanon, stakeholders, instructionsForAgent };
}

// Canon without RAG, without a focus document and without an LLM call — one
// project lookup plus two small selects. Cheap enough for an agent to call at
// the start of every conversation, which is exactly what it is for.
export async function getCanon(
  userId: string,
  input: GetCanonInput,
  meta: InvocationMeta,
): Promise<GetCanonResult> {
  const start = Date.now();
  const project = await resolveProject(userId, input.projectSlug, meta.clientScope);
  const { mergedCanon, stakeholders, instructionsForAgent } = await loadCanonBundle(
    userId,
    project,
    "canon",
  );

  await recordInvocation({
    corpusDb: project.corpusDb,
    userId,
    projectId: project.projectId,
    operation: "get_canon",
    sessionId: meta.sessionId,
    status: "success",
    userPrompt: `projectSlug=${input.projectSlug}`,
    systemPrompt: governingPrompt(instructionsForAgent, mergedCanon),
    retrievedChunks: {},
    latencyMs: Date.now() - start,
  });

  return {
    project: { slug: project.projectSlug, name: project.projectName },
    client: { slug: project.clientSlug, name: project.clientName },
    canon: {
      conventions: mergedCanon.conventions,
      guidelines: mergedCanon.guidelines,
      architecture: mergedCanon.architecture,
      source: mergedCanon.source,
      domain: mergedCanon.domain,
    },
    stakeholders,
    instructionsForAgent,
  };
}

export async function composeContext(
  userId: string,
  input: ComposeContextInput,
  meta: InvocationMeta,
): Promise<ComposeContextResult> {
  const start = Date.now();
  const project = await resolveProject(userId, input.projectSlug, meta.clientScope);

  let focus: FocusDocument | null = null;
  let focusReason = "";

  try {
    if (input.focusExternalId) {
      focus = await loadFocus(project.corpusDb, project.projectId, input.focusExternalId);
      if (!focus) {
        throw new ComposeError(
          "focus_not_found",
          `Focus document '${input.focusExternalId}' not found in project '${project.projectSlug}'`,
          404,
        );
      }
      focusReason = `focusExternalId=${input.focusExternalId}`;
    } else if (input.focusText) {
      focusReason = `focusText (${input.focusText.length} chars)`;
    } else {
      // Schema refine should prevent this; defensive throw.
      throw new ComposeError("invalid_input", "No focus provided.", 400);
    }

    // Build the search query from the focus content (truncated) or the
    // free-form focus text.
    const searchQuery = focus
      ? focus.content.slice(0, FOCUS_QUERY_CHAR_LIMIT)
      : (input.focusText ?? "");

    const searchResult = await search(
      userId,
      {
        query: searchQuery,
        projectSlug: input.projectSlug,
        topK: input.topK,
        minSimilarity: input.minSimilarity,
        useRerank: true,
      },
      meta,
    );

    // Drop chunks that come from the focus document itself — the caller
    // already has its full content separately.
    const focusId = focus?.documentId;
    const ragChunks = focusId
      ? searchResult.chunks.filter((c) => c.documentId !== focusId)
      : searchResult.chunks;

    // Linked documents (only when focus is present).
    let linkedFlat: LinkedDocument[] = [];
    if (focus) {
      linkedFlat = await loadLinkedDocuments(project.corpusDb, focus.documentId);
    }
    const { mergedCanon, stakeholders, instructionsForAgent } = await loadCanonBundle(
      userId,
      project,
      "compose",
    );

    // Everything below lands in the agent's context window, so it is fitted
    // to a budget before being assembled — the canon first and untouched,
    // then the focus, then supporting material.
    const canonTokens =
      approxTokens(mergedCanon.conventions ?? "") +
      approxTokens(mergedCanon.guidelines ?? "") +
      approxTokens(mergedCanon.architecture ?? "");

    const fitted = applyBudget({
      limitTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      canonTokens,
      instructionsTokens: approxTokens(instructionsForAgent),
      focus,
      linked: linkedFlat,
      ragChunks,
    });

    const linked: Record<string, LinkedDocument[]> = {};
    for (const doc of fitted.linked) {
      const bucket = bucketName(doc.type);
      const existing = linked[bucket];
      if (existing) {
        existing.push(doc);
      } else {
        linked[bucket] = [doc];
      }
    }

    const result: ComposeContextResult = {
      project: { slug: project.projectSlug, name: project.projectName },
      client: { slug: project.clientSlug, name: project.clientName },
      canon: {
        conventions: mergedCanon.conventions,
        guidelines: mergedCanon.guidelines,
        architecture: mergedCanon.architecture,
        source: mergedCanon.source,
        domain: mergedCanon.domain,
      },
      focus: fitted.focus,
      linked,
      ragChunks: fitted.ragChunks,
      stakeholders,
      instructionsForAgent: withBudgetNotice(instructionsForAgent, fitted.budget),
      metadata: {
        focusReason,
        chunksRetrieved: fitted.ragChunks.length,
        linksFollowed: linkedFlat.length,
        rerankUsed: searchResult.reranked,
        budget: fitted.budget,
      },
    };

    await recordInvocation({
      corpusDb: project.corpusDb,
      userId,
      projectId: project.projectId,
      operation: "compose_context",
      sessionId: meta.sessionId,
      targetExternalId: input.focusExternalId ?? null,
      status: "success",
      userPrompt: focusReason,
      // What actually governed the agent on this call: the instructions plus
      // the canon text that was in force. The canon can be edited afterwards;
      // this is the only copy tied to the moment.
      systemPrompt: governingPrompt(instructionsForAgent, mergedCanon),
      retrievedChunks: {
        focusDocumentId: focus?.documentId ?? null,
        ragDocumentIds: Array.from(new Set(ragChunks.map((c) => c.documentId))),
        linkedDocumentIds: linkedFlat.map((d) => d.documentId),
      },
      latencyMs: Date.now() - start,
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordInvocation({
      corpusDb: project.corpusDb,
      userId,
      projectId: project.projectId,
      operation: "compose_context",
      sessionId: meta.sessionId,
      targetExternalId: input.focusExternalId ?? null,
      status: "error",
      userPrompt: focusReason || "(no focus resolved)",
      retrievedChunks: {},
      errorDetail: message,
      latencyMs: Date.now() - start,
    });
    throw err;
  }
}
