import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@workbrain/shared";
import { type InvocationMeta, recordInvocation } from "./audit";
import type { WorkbrainDb } from "./db";
import { TenancyError, resolveProjectContext } from "./tenancy";

export const LINK_TYPES = [
  "depends_on",
  "related",
  "supersedes",
  "discusses",
  "decided_in",
  "references",
] as const;

export type LinkType = (typeof LINK_TYPES)[number];

export const LinkDocumentsInputSchema = z
  .object({
    fromExternalId: z.string().min(1).optional(),
    fromPath: z.string().min(1).optional(),
    toExternalId: z.string().min(1).optional(),
    toPath: z.string().min(1).optional(),
    linkType: z.enum(LINK_TYPES),
    note: z.string().min(1).optional(),
    projectSlug: z.string().min(1),
  })
  .refine((d) => Boolean(d.fromExternalId) !== Boolean(d.fromPath), {
    message: "Provide exactly one of fromExternalId or fromPath",
  })
  .refine((d) => Boolean(d.toExternalId) !== Boolean(d.toPath), {
    message: "Provide exactly one of toExternalId or toPath",
  });

export type LinkDocumentsInput = z.infer<typeof LinkDocumentsInputSchema>;

export interface LinkResult {
  linkId: string;
  fromDocumentId: string;
  toDocumentId: string;
  linkType: LinkType;
  note: string | null;
  alreadyExisted: boolean;
}

export class LinkError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "LinkError";
    this.code = code;
    this.status = status;
  }
}

interface ResolvedDoc {
  id: string;
  projectId: string;
  externalId: string | null;
  path: string;
}

// Ownership used to be proven by joining documents -> projects -> clients.
// The project now lives centrally and the document in the client's database,
// so ownership is established once by resolving the project, and the document
// lookup is scoped to that project id inside the corpus database.
async function resolveDocument(
  corpusDb: WorkbrainDb,
  projectId: string,
  projectSlug: string,
  by: { externalId?: string; path?: string },
  side: "from" | "to",
): Promise<ResolvedDoc> {
  const conditions = [eq(schema.documents.projectId, projectId)];
  if (by.externalId) {
    conditions.push(eq(schema.documents.externalId, by.externalId));
  } else if (by.path) {
    conditions.push(eq(schema.documents.path, by.path));
  }

  const rows = await corpusDb
    .select({
      id: schema.documents.id,
      projectId: schema.documents.projectId,
      externalId: schema.documents.externalId,
      path: schema.documents.path,
    })
    .from(schema.documents)
    .where(and(...conditions))
    .limit(1);

  const row = rows[0];
  if (!row) {
    const ref = by.externalId ?? by.path ?? "(unspecified)";
    throw new LinkError(
      "document_not_found",
      `${side} document not found in project '${projectSlug}': ${ref}`,
      404,
    );
  }
  return row;
}

export async function linkDocuments(
  userId: string,
  input: LinkDocumentsInput,
  meta: InvocationMeta = {},
): Promise<LinkResult> {
  const start = Date.now();
  const project = await resolveProjectContext(userId, input.projectSlug).catch((err: unknown) => {
    if (err instanceof TenancyError) throw new LinkError(err.code, err.message, err.status);
    throw err;
  });
  const corpusDb = project.corpusDb;

  const from = await resolveDocument(
    corpusDb,
    project.projectId,
    input.projectSlug,
    { externalId: input.fromExternalId, path: input.fromPath },
    "from",
  );
  const to = await resolveDocument(
    corpusDb,
    project.projectId,
    input.projectSlug,
    { externalId: input.toExternalId, path: input.toPath },
    "to",
  );

  // Defensive check; both queries already filtered by projectSlug, but
  // cross-project links are the worst possible bug here so make it explicit.
  if (from.projectId !== to.projectId) {
    throw new LinkError(
      "cross_project_link_forbidden",
      "Cannot link documents across projects.",
      400,
    );
  }

  if (from.id === to.id) {
    throw new LinkError("self_link_forbidden", "Cannot link a document to itself.", 400);
  }

  // Idempotency: same (from, to, linkType) → return the existing row, do not
  // overwrite its note. If the caller wants to change the note they have to
  // delete + recreate (no update endpoint in Phase 2).
  const existing = await corpusDb
    .select({ id: schema.documentLinks.id, note: schema.documentLinks.note })
    .from(schema.documentLinks)
    .where(
      and(
        eq(schema.documentLinks.fromDocumentId, from.id),
        eq(schema.documentLinks.toDocumentId, to.id),
        eq(schema.documentLinks.linkType, input.linkType),
      ),
    )
    .limit(1);

  const existingRow = existing[0];
  if (existingRow) {
    await recordInvocation({
      corpusDb,
      userId,
      projectId: from.projectId,
      operation: "link_documents",
      activityKind: "document_linked",
      targetExternalId: input.fromExternalId ?? input.toExternalId ?? null,
      sessionId: meta.sessionId,
      status: "success",
      userPrompt: `link_documents ${input.linkType} (already existed)`,
      latencyMs: Date.now() - start,
      responseText: existingRow.id,
    });
    return {
      linkId: existingRow.id,
      fromDocumentId: from.id,
      toDocumentId: to.id,
      linkType: input.linkType,
      note: existingRow.note,
      alreadyExisted: true,
    };
  }

  const inserted = await corpusDb
    .insert(schema.documentLinks)
    .values({
      fromDocumentId: from.id,
      toDocumentId: to.id,
      linkType: input.linkType,
      note: input.note ?? null,
    })
    .returning({ id: schema.documentLinks.id });

  const insertedRow = inserted[0];
  if (!insertedRow) {
    throw new LinkError("insert_failed", "Failed to insert document link.", 500);
  }

  await recordInvocation({
    corpusDb,
    userId,
    projectId: from.projectId,
    operation: "link_documents",
    activityKind: "document_linked",
    targetExternalId: input.fromExternalId ?? input.toExternalId ?? null,
    sessionId: meta.sessionId,
    status: "success",
    userPrompt: `link_documents ${input.linkType} from=${input.fromExternalId ?? input.fromPath} to=${input.toExternalId ?? input.toPath}`,
    latencyMs: Date.now() - start,
    responseText: insertedRow.id,
  });

  return {
    linkId: insertedRow.id,
    fromDocumentId: from.id,
    toDocumentId: to.id,
    linkType: input.linkType,
    note: input.note ?? null,
    alreadyExisted: false,
  };
}
