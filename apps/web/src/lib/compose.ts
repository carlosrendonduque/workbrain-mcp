import { schema } from "@workbrain/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type InvocationMeta, recordInvocation } from "./audit";
import { getCanonDomainById, type MergedCanon, mergeCanon } from "./canon-domains";
import { db } from "./db";
import { type SearchChunk, search } from "./search";

export const ComposeContextInputSchema = z
  .object({
    projectSlug: z.string().min(1),
    focusExternalId: z.string().min(1).optional(),
    focusText: z.string().min(1).optional(),
    topK: z.number().int().min(1).max(50).optional(),
    minSimilarity: z.number().min(0).max(1).optional(),
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

interface ResolvedProject {
  projectId: string;
  projectSlug: string;
  projectName: string;
  clientId: string;
  clientSlug: string;
  clientName: string;
  conventions: string | null;
  guidelines: string | null;
  architecture: string | null;
  domainId: string | null;
}

async function resolveProject(userId: string, projectSlug: string): Promise<ResolvedProject> {
  const rows = await db
    .select({
      projectId: schema.projects.id,
      projectSlug: schema.projects.slug,
      projectName: schema.projects.name,
      clientId: schema.clients.id,
      clientSlug: schema.clients.slug,
      clientName: schema.clients.name,
      conventions: schema.projects.conventions,
      guidelines: schema.projects.guidelines,
      architecture: schema.projects.architecture,
      domainId: schema.projects.domainId,
    })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.projects.clientId, schema.clients.id))
    .where(and(eq(schema.clients.userId, userId), eq(schema.projects.slug, projectSlug)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new ComposeError(
      "project_not_found",
      `Project not found for active user: ${projectSlug}`,
      404,
    );
  }
  return row;
}

async function loadFocus(projectId: string, externalId: string): Promise<FocusDocument | null> {
  const rows = await db
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

async function loadLinkedDocuments(focusId: string): Promise<LinkedDocument[]> {
  const rows = await db
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
  return rows;
}

async function loadStakeholders(projectId: string): Promise<StakeholderInScope[]> {
  const rows = await db
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
  project: ResolvedProject,
  mode: "compose" | "canon",
): Promise<{
  mergedCanon: MergedCanon;
  stakeholders: StakeholderInScope[];
  instructionsForAgent: string;
}> {
  const stakeholders = await loadStakeholders(project.projectId);
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
  meta: InvocationMeta = {},
): Promise<GetCanonResult> {
  const start = Date.now();
  const project = await resolveProject(userId, input.projectSlug);
  const { mergedCanon, stakeholders, instructionsForAgent } = await loadCanonBundle(
    userId,
    project,
    "canon",
  );

  await recordInvocation({
    userId,
    projectId: project.projectId,
    operation: "get_canon",
    sessionId: meta.sessionId,
    status: "success",
    userPrompt: `projectSlug=${input.projectSlug}`,
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
  meta: InvocationMeta = {},
): Promise<ComposeContextResult> {
  const start = Date.now();
  const project = await resolveProject(userId, input.projectSlug);

  let focus: FocusDocument | null = null;
  let focusReason = "";

  try {
    if (input.focusExternalId) {
      focus = await loadFocus(project.projectId, input.focusExternalId);
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

    const searchResult = await search(userId, {
      query: searchQuery,
      projectSlug: input.projectSlug,
      topK: input.topK,
      minSimilarity: input.minSimilarity,
      useRerank: true,
    });

    // Drop chunks that come from the focus document itself — the caller
    // already has its full content separately.
    const focusId = focus?.documentId;
    const ragChunks = focusId
      ? searchResult.chunks.filter((c) => c.documentId !== focusId)
      : searchResult.chunks;

    // Linked documents (only when focus is present).
    let linkedFlat: LinkedDocument[] = [];
    if (focus) {
      linkedFlat = await loadLinkedDocuments(focus.documentId);
    }
    const linked: Record<string, LinkedDocument[]> = {};
    for (const doc of linkedFlat) {
      const bucket = bucketName(doc.type);
      const existing = linked[bucket];
      if (existing) {
        existing.push(doc);
      } else {
        linked[bucket] = [doc];
      }
    }

    const { mergedCanon, stakeholders, instructionsForAgent } = await loadCanonBundle(
      userId,
      project,
      "compose",
    );

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
      focus,
      linked,
      ragChunks,
      stakeholders,
      instructionsForAgent,
      metadata: {
        focusReason,
        chunksRetrieved: ragChunks.length,
        linksFollowed: linkedFlat.length,
        rerankUsed: searchResult.reranked,
      },
    };

    await recordInvocation({
      userId,
      projectId: project.projectId,
      operation: "compose_context",
      sessionId: meta.sessionId,
      targetExternalId: input.focusExternalId ?? null,
      status: "success",
      userPrompt: focusReason,
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
