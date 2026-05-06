import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@workbrain/shared";
import { db } from "./db";

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

async function resolveDocument(
  userId: string,
  projectSlug: string,
  by: { externalId?: string; path?: string },
  side: "from" | "to",
): Promise<ResolvedDoc> {
  const conditions = [eq(schema.clients.userId, userId), eq(schema.projects.slug, projectSlug)];
  if (by.externalId) {
    conditions.push(eq(schema.documents.externalId, by.externalId));
  } else if (by.path) {
    conditions.push(eq(schema.documents.path, by.path));
  }

  const rows = await db
    .select({
      id: schema.documents.id,
      projectId: schema.documents.projectId,
      externalId: schema.documents.externalId,
      path: schema.documents.path,
    })
    .from(schema.documents)
    .innerJoin(schema.projects, eq(schema.documents.projectId, schema.projects.id))
    .innerJoin(schema.clients, eq(schema.projects.clientId, schema.clients.id))
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
): Promise<LinkResult> {
  const from = await resolveDocument(
    userId,
    input.projectSlug,
    { externalId: input.fromExternalId, path: input.fromPath },
    "from",
  );
  const to = await resolveDocument(
    userId,
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
  const existing = await db
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
    return {
      linkId: existingRow.id,
      fromDocumentId: from.id,
      toDocumentId: to.id,
      linkType: input.linkType,
      note: existingRow.note,
      alreadyExisted: true,
    };
  }

  const inserted = await db
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

  return {
    linkId: insertedRow.id,
    fromDocumentId: from.id,
    toDocumentId: to.id,
    linkType: input.linkType,
    note: input.note ?? null,
    alreadyExisted: false,
  };
}
