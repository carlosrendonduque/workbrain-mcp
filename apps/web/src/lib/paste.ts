import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@workbrain/shared";
import { ClassifierError, type ClassifierUsage, classify } from "./classifier";
import { buildDocumentPath, writeDocument } from "./corpus";
import { db } from "./db";
import { chunkMarkdown } from "./chunking";
import { embed } from "./embeddings";
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

interface ResolvedProject {
  projectId: string;
  projectSlug: string;
  clientId: string;
  clientSlug: string;
  persist: boolean;
}

async function resolveProject(userId: string, projectSlug: string): Promise<ResolvedProject> {
  const rows = await db
    .select({
      projectId: schema.projects.id,
      projectSlug: schema.projects.slug,
      clientId: schema.clients.id,
      clientSlug: schema.clients.slug,
      persist: schema.projects.persist,
    })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.projects.clientId, schema.clients.id))
    .where(and(eq(schema.clients.userId, userId), eq(schema.projects.slug, projectSlug)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new IngestError(
      "project_not_found",
      `Project not found for active user: ${projectSlug}`,
      404,
    );
  }
  return row;
}

interface AuditArgs {
  userId: string;
  projectId: string;
  status: "success" | "error";
  userPrompt: string;
  retrievedChunks: unknown;
  errorDetail?: string;
  latencyMs: number;
  classifierUsage?: ClassifierUsage;
  classifierCost?: string;
  classifierResponse?: string;
}

async function recordAudit(args: AuditArgs): Promise<void> {
  try {
    await db.insert(schema.invocations).values({
      userId: args.userId,
      projectId: args.projectId,
      operation: "ingest_paste",
      userPrompt: args.userPrompt,
      retrievedChunks: args.retrievedChunks,
      status: args.status,
      errorDetail: args.errorDetail,
      latencyMs: args.latencyMs,
      provider: args.classifierUsage ? "anthropic" : "none",
      model: args.classifierUsage ? "claude-sonnet-4-6" : "none",
      promptTokens: args.classifierUsage?.inputTokens ?? null,
      completionTokens: args.classifierUsage?.outputTokens ?? null,
      costUsd: args.classifierCost ?? null,
      responseText: args.classifierResponse ?? null,
    });
  } catch (err) {
    console.error("audit insert failed:", err);
  }
}

export async function ingestPaste(
  userId: string,
  input: IngestPasteInput,
): Promise<IngestPasteResult> {
  const start = Date.now();

  let projectInfo: ResolvedProject | null = null;
  let classifierUsage: ClassifierUsage | undefined;
  let classifierCost: string | undefined;
  let classifierResponse: string | undefined;
  let inferredType: DocumentType | undefined;
  let inferredExternalId: string | undefined;
  let inferredDate: string | undefined;

  try {
    projectInfo = await resolveProject(userId, input.projectSlug);

    // Auto-classify only when caller did not pass type. The classifier is a
    // fallback, not a validator — explicit type from the caller is always honored.
    if (!input.type) {
      try {
        const out = await classify(input.content);
        inferredType = out.result.type;
        inferredExternalId = out.result.externalId;
        inferredDate = out.result.detectedDate;
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
    await ensureRepo(repo);
    const written = await writeDocument(relativePath, frontmatter, input.content, {
      rootPath: repo.rootPath,
    });

    const inserted = await db
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
      const embeddings = await embed(
        chunks.map((c) => c.text),
        "document",
      );
      if (embeddings.length !== chunks.length) {
        throw new IngestError(
          "embedding_mismatch",
          `Expected ${chunks.length} embeddings, got ${embeddings.length}`,
          500,
        );
      }

      const project = projectInfo;
      const chunkRows = chunks.map((chunk, i) => {
        const embedding = embeddings[i];
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
        };
      });

      await db.insert(schema.chunks).values(chunkRows);
      chunkCount = chunkRows.length;
    }

    void commitAndPush(
      written.relativePath,
      `feat(ingest): ${finalType} ${finalExternalId ?? slugifyTitle(input.title)}`,
      repo,
    );

    await recordAudit({
      userId,
      projectId: projectInfo.projectId,
      status: "success",
      userPrompt: `ingest_paste type=${finalType} title="${input.title}" classified=${classifierUsage !== undefined}`,
      retrievedChunks: [],
      latencyMs: Date.now() - start,
      classifierUsage,
      classifierCost,
      classifierResponse,
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
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (projectInfo) {
      await recordAudit({
        userId,
        projectId: projectInfo.projectId,
        status: "error",
        userPrompt: `ingest_paste type=${input.type ?? "(auto)"} title="${input.title}"`,
        retrievedChunks: [],
        errorDetail: message,
        latencyMs: Date.now() - start,
        classifierUsage,
        classifierCost,
        classifierResponse,
      });
    }
    throw err;
  }
}
