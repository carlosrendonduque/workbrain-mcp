import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@workbrain/shared";
import { type InvocationMeta, recordInvocation } from "./audit";
import { ClassifierError, type ClassifierUsage, classify } from "./classifier";
import { buildDocumentPath, writeDocument } from "./corpus";
import type { WorkbrainDb } from "./db";
import { chunkMarkdown } from "./chunking";
import { assertConsistentEmbeddingModel, resolveEmbeddings, resolveLlm } from "./providers";
import {
  type ClientScope,
  type ProjectContext,
  TenancyError,
  resolveProjectContext,
} from "./tenancy";
import { commitAndPush, ensureRepo, loadRepoConfigFromEnv } from "./git";

const DOCUMENT_TYPES = [
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

type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const IngestPasteInputSchema = z.object({
  projectSlug: z.string().min(1),
  type: z.enum(DOCUMENT_TYPES).optional(),
  title: z.string().min(1),
  content: z.string().min(1),
  externalId: z.string().min(1).optional(),
  status: z.enum(["open", "in_progress", "resolved"]).optional(),
  tags: z.array(z.string()).optional(),
  relatedTickets: z.array(z.string()).optional(),
});

export type IngestPasteInput = z.infer<typeof IngestPasteInputSchema>;

export interface AutoLink {
  toDocumentId: string;
  externalId: string;
  linkType: string;
  source: "classifier" | "input";
}

export interface IngestPasteResult {
  documentId: string;
  path: string;
  frontmatter: Record<string, unknown>;
  chunkCount: number;
  classified: boolean;
  inferredType?: DocumentType;
  inferredExternalId?: string;
  inferredDate?: string;
  classifierCostUsd?: string;
  autoLinks: AutoLink[];
  unmatchedReferences: string[];
}

export class IngestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "IngestError";
    this.code = code;
    this.status = status;
  }
}

const TYPE_FOLDERS: Record<DocumentType, string> = {
  ticket: "tickets",
  confluence: "confluence",
  teams_thread: "teams",
  email: "emails",
  transcript: "transcripts",
  decision: "decisions",
  convention: "conventions",
  guideline: "guidelines",
  stakeholder: "stakeholders",
  task: "tasks",
  note: "notes",
};

// Sonnet 4.6 list prices (USD per 1M tokens). Cache reads bill at 10% of input,
// cache writes at 1.25x. Used to populate invocations.cost_usd for the audit row.
const SONNET_PRICING = {
  input: 3 / 1_000_000,
  output: 15 / 1_000_000,
  cacheRead: 0.3 / 1_000_000,
  cacheWrite: 3.75 / 1_000_000,
};

function classifierCostUsd(usage: ClassifierUsage): string {
  const cost =
    usage.inputTokens * SONNET_PRICING.input +
    usage.outputTokens * SONNET_PRICING.output +
    usage.cacheReadInputTokens * SONNET_PRICING.cacheRead +
    usage.cacheCreationInputTokens * SONNET_PRICING.cacheWrite;
  return cost.toFixed(6);
}

/**
 * Free text to a filename-safe slug.
 *
 * This is where stripping accents belongs: a title is a label and may contain
 * anything. It is NOT the same job as envVarNameForClient, which receives a
 * slug that was already validated and rejects anything else rather than
 * rewriting it.
 */
function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug.length > 0 ? slug : "untitled";
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ReferenceCandidate {
  externalId: string;
  source: "classifier" | "input";
}

interface AutoLinkOutcome {
  links: AutoLink[];
  unmatched: string[];
}

// Auto-link the freshly inserted document to other documents in the SAME
// project whose external_id matches anything the classifier extracted or the
// caller passed via relatedTickets. Cross-project links are never created
// automatically (governance: each client/project is an architecturally
// guaranteed silo). Self-links are skipped.
async function autoLinkReferences(args: {
  corpusDb: WorkbrainDb;
  fromDocumentId: string;
  projectId: string;
  candidates: ReferenceCandidate[];
}): Promise<AutoLinkOutcome> {
  if (args.candidates.length === 0) {
    return { links: [], unmatched: [] };
  }

  // Dedupe by externalId; caller-supplied references take precedence over the
  // classifier's extraction when both reference the same ID.
  const sourceByExternalId = new Map<string, "classifier" | "input">();
  for (const c of args.candidates) {
    if (c.source === "classifier" && sourceByExternalId.has(c.externalId)) continue;
    sourceByExternalId.set(c.externalId, c.source);
  }
  const externalIds = Array.from(sourceByExternalId.keys());

  const matches = await args.corpusDb
    .select({
      id: schema.documents.id,
      externalId: schema.documents.externalId,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.projectId, args.projectId),
        inArray(schema.documents.externalId, externalIds),
      ),
    );

  const idByExternalId = new Map<string, string>();
  for (const m of matches) {
    if (m.externalId) idByExternalId.set(m.externalId, m.id);
  }

  const links: AutoLink[] = [];
  const linkRows: {
    fromDocumentId: string;
    toDocumentId: string;
    linkType: string;
    note: string;
  }[] = [];
  const unmatched: string[] = [];

  for (const externalId of externalIds) {
    const toId = idByExternalId.get(externalId);
    if (!toId) {
      unmatched.push(externalId);
      continue;
    }
    if (toId === args.fromDocumentId) {
      // Self-reference (re-ingest of the same document); skip silently.
      continue;
    }
    const source = sourceByExternalId.get(externalId) ?? "classifier";
    linkRows.push({
      fromDocumentId: args.fromDocumentId,
      toDocumentId: toId,
      linkType: "references",
      note: `auto-linked from ${source}`,
    });
    links.push({ toDocumentId: toId, externalId, linkType: "references", source });
  }

  if (linkRows.length > 0) {
    await args.corpusDb.insert(schema.documentLinks).values(linkRows);
  }
  return { links, unmatched };
}

async function resolveProject(
  userId: string,
  projectSlug: string,
  scope: ClientScope,
): Promise<ProjectContext> {
  try {
    return await resolveProjectContext(userId, projectSlug, scope);
  } catch (err) {
    if (err instanceof TenancyError) throw new IngestError(err.code, err.message, err.status);
    throw err;
  }
}

export async function ingestPaste(
  userId: string,
  input: IngestPasteInput,
  meta: InvocationMeta,
): Promise<IngestPasteResult> {
  const start = Date.now();

  let projectInfo: ProjectContext | null = null;
  let classifierUsage: ClassifierUsage | undefined;
  let classifierCost: string | undefined;
  let classifierResponse: string | undefined;
  let inferredType: DocumentType | undefined;
  let inferredExternalId: string | undefined;
  let inferredDate: string | undefined;
  let inferredReferences: string[] = [];

  try {
    projectInfo = await resolveProject(userId, input.projectSlug, meta.clientScope);

    // Auto-classify only when caller did not pass type. The classifier is a
    // fallback, not a validator — explicit type from the caller is always honored.
    if (!input.type) {
      try {
        // Through this client's provider, so a client routed to their own
        // cloud account never has their text sent to ours for classification.
        const llm = resolveLlm(projectInfo);
        const out = await classify(input.content, { client: llm.client, model: llm.model });
        inferredType = out.result.type;
        inferredExternalId = out.result.externalId;
        inferredDate = out.result.detectedDate;
        inferredReferences = out.result.references;
        classifierUsage = out.usage;
        classifierCost = classifierCostUsd(out.usage);
        classifierResponse = JSON.stringify(out.result);
      } catch (err) {
        if (err instanceof ClassifierError) {
          throw new IngestError(
            "classification_failed",
            `Auto-classification failed (${err.code}): ${err.message}. Pass an explicit type to skip the classifier.`,
            err.status,
          );
        }
        throw err;
      }
    }

    const finalType: DocumentType = input.type ?? inferredType ?? "note";
    const finalExternalId = input.externalId ?? inferredExternalId;
    const created = inferredDate ?? todayIsoDate();
    const updated = todayIsoDate();

    const fileBase = finalExternalId ?? slugifyTitle(input.title);
    const fileName = `${fileBase}.md`;
    const typeFolder = TYPE_FOLDERS[finalType];
    const relativePath = buildDocumentPath({
      clientSlug: projectInfo.clientSlug,
      projectSlug: projectInfo.projectSlug,
      typeFolder,
      fileName,
    });

    const frontmatter: Record<string, unknown> = {
      type: finalType,
      project: projectInfo.projectSlug,
      client: projectInfo.clientSlug,
      ...(finalExternalId ? { external_id: finalExternalId } : {}),
      title: input.title,
      ...(input.status ? { status: input.status } : {}),
      created,
      updated,
      ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
      ...(input.relatedTickets && input.relatedTickets.length > 0
        ? { related_tickets: input.relatedTickets }
        : {}),
      persist: projectInfo.persist,
    };

    const repo = await loadRepoConfigFromEnv();
    let writtenRelativePath: string | null = null;
    if (repo) {
      await ensureRepo(repo);
      const written = await writeDocument(relativePath, frontmatter, input.content, {
        rootPath: repo.rootPath,
      });
      writtenRelativePath = written.relativePath;
    }

    const inserted = await projectInfo.corpusDb
      .insert(schema.documents)
      .values({
        projectId: projectInfo.projectId,
        type: finalType,
        externalId: finalExternalId ?? null,
        path: relativePath,
        title: input.title,
        content: input.content,
        frontmatter,
        status: input.status ?? null,
      })
      .returning({ id: schema.documents.id });

    const documentRow = inserted[0];
    if (!documentRow) {
      throw new IngestError("document_insert_failed", "Failed to insert document row", 500);
    }
    const documentId = documentRow.id;

    const chunks = chunkMarkdown(input.content);
    let chunkCount = 0;
    if (chunks.length > 0) {
      const embeddings = resolveEmbeddings(projectInfo);
      // Refuse before writing anything, not after: vectors from two models
      // are not comparable, so mixing them would leave search quietly wrong
      // with nothing to point at.
      await assertConsistentEmbeddingModel(
        projectInfo.corpusDb,
        projectInfo.projectId,
        embeddings.model,
      );
      const vectors = await embeddings.embed(
        chunks.map((c) => c.text),
        "document",
      );
      if (vectors.length !== chunks.length) {
        throw new IngestError(
          "embedding_mismatch",
          `Expected ${chunks.length} embeddings, got ${vectors.length}`,
          500,
        );
      }

      const project = projectInfo;
      const chunkRows = chunks.map((chunk, i) => {
        const embedding = vectors[i];
        if (!embedding) {
          throw new IngestError("missing_embedding", `No embedding for chunk ${i}`, 500);
        }
        return {
          documentId,
          projectId: project.projectId,
          clientId: project.clientId,
          type: finalType,
          chunkIndex: chunk.index,
          text: chunk.text,
          tokenCount: chunk.tokenCount,
          embedding,
          embeddingModel: embeddings.model,
        };
      });

      await projectInfo.corpusDb.insert(schema.chunks).values(chunkRows);
      chunkCount = chunkRows.length;
    }

    // Auto-link to other documents in the same project that match any
    // external_id the classifier extracted or the caller passed manually.
    // Self-references (a document linking to itself, e.g. on re-ingest) are
    // skipped inside autoLinkReferences.
    const referenceCandidates: ReferenceCandidate[] = [];
    for (const externalId of inferredReferences) {
      referenceCandidates.push({ externalId, source: "classifier" });
    }
    if (input.relatedTickets) {
      for (const externalId of input.relatedTickets) {
        referenceCandidates.push({ externalId, source: "input" });
      }
    }
    const linkOutcome = await autoLinkReferences({
      corpusDb: projectInfo.corpusDb,
      fromDocumentId: documentId,
      projectId: projectInfo.projectId,
      candidates: referenceCandidates,
    });

    if (repo && writtenRelativePath) {
      void commitAndPush(
        writtenRelativePath,
        `feat(ingest): ${finalType} ${finalExternalId ?? slugifyTitle(input.title)}`,
        repo,
      );
    }

    await recordInvocation({
      corpusDb: projectInfo.corpusDb,
      userId,
      projectId: projectInfo.projectId,
      operation: "ingest_paste",
      activityKind: "document_ingested",
      targetExternalId: finalExternalId ?? null,
      sessionId: meta.sessionId,
      status: "success",
      userPrompt: `ingest_paste type=${finalType} title="${input.title}" classified=${classifierUsage !== undefined}`,
      retrievedChunks: [],
      latencyMs: Date.now() - start,
      provider: classifierUsage ? "anthropic" : "none",
      model: classifierUsage ? "claude-sonnet-4-6" : "none",
      promptTokens: classifierUsage?.inputTokens ?? null,
      completionTokens: classifierUsage?.outputTokens ?? null,
      costUsd: classifierCost ?? null,
      responseText: classifierResponse ?? null,
    });

    return {
      documentId,
      path: relativePath,
      frontmatter,
      chunkCount,
      classified: classifierUsage !== undefined,
      inferredType,
      inferredExternalId,
      inferredDate,
      classifierCostUsd: classifierCost,
      autoLinks: linkOutcome.links,
      unmatchedReferences: linkOutcome.unmatched,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (projectInfo) {
      await recordInvocation({
        corpusDb: projectInfo.corpusDb,
        userId,
        projectId: projectInfo.projectId,
        operation: "ingest_paste",
        activityKind: "document_ingested",
        sessionId: meta.sessionId,
        status: "error",
        userPrompt: `ingest_paste type=${input.type ?? "(auto)"} title="${input.title}"`,
        retrievedChunks: [],
        errorDetail: message,
        latencyMs: Date.now() - start,
        provider: classifierUsage ? "anthropic" : "none",
        model: classifierUsage ? "claude-sonnet-4-6" : "none",
        promptTokens: classifierUsage?.inputTokens ?? null,
        completionTokens: classifierUsage?.outputTokens ?? null,
        costUsd: classifierCost ?? null,
        responseText: classifierResponse ?? null,
      });
    }
    throw err;
  }
}
