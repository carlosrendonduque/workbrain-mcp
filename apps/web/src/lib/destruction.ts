import { createHash } from "node:crypto";
import { schema } from "@workbrain/shared";
import { and, eq, inArray } from "drizzle-orm";
import { type WorkbrainDb, corpusDbFor, db } from "./db";
import { CORPUS_TABLES, type CorpusCounts, countCorpus, purgeCorpus } from "./provisioning";

/**
 * Destroying a client's corpus when the engagement ends, and proving it.
 *
 * The exit is a feature. Being able to show exactly how it finishes — what
 * was removed, when, and a commitment to which set of documents — is what
 * lets a client say yes at the START. A vendor who cannot describe the ending
 * is asking to be trusted rather than checked.
 *
 * Two properties this is built around:
 *
 *   The certificate outlives the data. It is written to the CENTRAL database
 *   with the client's slug and name copied in rather than referenced, so it
 *   survives the client row being removed later.
 *
 *   The digest cannot be produced afterwards. It is taken over the document
 *   ids that existed at the moment of destruction; once they are gone the
 *   number cannot be recomputed, so a certificate cannot be back-dated or
 *   fitted to a different set.
 */

export interface DestructionPreview {
  clientId: string;
  clientSlug: string;
  clientName: string;
  projectSlugs: string[];
  projectIds: string[];
  storage: string;
  counts: CorpusCounts;
  documentIds: string[];
  corpusDb: WorkbrainDb;
  dedicated: boolean;
}

export interface Certificate {
  clientSlug: string;
  clientName: string;
  projectSlugs: string[];
  removed: CorpusCounts;
  documentsDigest: string;
  storage: string;
  issuedAt: Date;
  markdown: string;
}

/**
 * A stable fingerprint of exactly which documents existed.
 *
 * Sorted so the same set always yields the same digest regardless of the
 * order rows came back in. Ids only — the digest must not be reversible into
 * anything about the content it stood for.
 */
export function digestDocumentIds(documentIds: string[]): string {
  const hash = createHash("sha256");
  for (const id of [...documentIds].sort()) hash.update(id);
  return hash.digest("hex");
}

function hostOf(url: string | undefined): string {
  if (!url) return "unknown";
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

/** Read what destruction would remove, without removing it. */
export async function previewDestruction(
  userId: string,
  clientSlug: string,
): Promise<DestructionPreview> {
  const clients = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.userId, userId), eq(schema.clients.slug, clientSlug)))
    .limit(1);
  const client = clients[0];
  if (!client) throw new Error(`No client with slug "${clientSlug}" for this user`);

  const projects = await db
    .select({ id: schema.projects.id, slug: schema.projects.slug })
    .from(schema.projects)
    .where(eq(schema.projects.clientId, client.id));
  const projectIds = projects.map((p) => p.id);

  const corpusDb = corpusDbFor(client);
  const dedicated = client.isolationMode === "dedicated";
  const storage = dedicated
    ? `dedicated database ${hostOf(
        client.corpusDbUrlEnv ? process.env[client.corpusDbUrlEnv] : undefined,
      )}`
    : "shared database";

  const counts = await countCorpus(corpusDb, projectIds);

  const documentIds =
    projectIds.length === 0
      ? []
      : (
          await corpusDb
            .select({ id: schema.documents.id })
            .from(schema.documents)
            .where(inArray(schema.documents.projectId, projectIds))
        ).map((r) => r.id);

  return {
    clientId: client.id,
    clientSlug: client.slug,
    clientName: client.name,
    projectSlugs: projects.map((p) => p.slug),
    projectIds,
    storage,
    counts,
    documentIds,
    corpusDb,
    dedicated,
  };
}

export function renderCertificate(cert: Omit<Certificate, "markdown">): string {
  const stamp = cert.issuedAt.toISOString().replace("T", " ").slice(0, 19);
  const removedRows = CORPUS_TABLES.filter((t) => cert.removed[t] > 0).map(
    (t) => `| ${t.replace(/_/g, " ")} | ${cert.removed[t]} |`,
  );
  // With the header, or it is not a table in any markdown renderer.
  const rows =
    removedRows.length > 0 ? `| What | Rows |\n|---|---|\n${removedRows.join("\n")}` : "";

  return `# Certificate of destruction — ${cert.clientName}

Issued ${stamp} UTC

The corpus held for this engagement has been destroyed. What follows was
recorded at the moment of deletion by the system that performed it.

| | |
|---|---|
| Client | ${cert.clientName} (\`${cert.clientSlug}\`) |
| Projects | ${cert.projectSlugs.map((s) => `\`${s}\``).join(", ") || "(none)"} |
| Held in | ${cert.storage} |

## What was removed

${rows || "Nothing — the corpus was already empty."}

## Commitment to the set

\`\`\`
sha256  ${cert.documentsDigest}
\`\`\`

A SHA-256 over the identifiers of every document that existed at the moment
of destruction. It commits this certificate to that exact set and discloses
nothing about the contents. It cannot be recomputed now that the documents
are gone, so it cannot be back-dated or fitted to a different set.

## What was not removed

The record that this engagement existed — the client name, the project names,
and this certificate — is retained. It carries no content from the
engagement, and it is what makes this document verifiable rather than a
claim.

${
  cert.storage.startsWith("dedicated")
    ? "Because this client held a database of its own, that database can now be\ndeleted outright, leaving nothing behind at the infrastructure level."
    : "This client shared a database with others. Its rows have been deleted; the\ndatabase itself remains in use by other engagements."
}
`;
}

/**
 * Destroy and certify, in that order, in one call.
 *
 * The digest is taken before deletion and the certificate is written after,
 * so a crash between them leaves a destroyed corpus with no certificate —
 * loud and recoverable — rather than a certificate for data still present,
 * which would be a false statement on record.
 */
export async function destroyClientCorpus(
  userId: string,
  clientSlug: string,
): Promise<Certificate> {
  const preview = await previewDestruction(userId, clientSlug);
  const documentsDigest = digestDocumentIds(preview.documentIds);

  const removed = await purgeCorpus(preview.corpusDb, preview.projectIds);

  const issuedAt = new Date();
  const base = {
    clientSlug: preview.clientSlug,
    clientName: preview.clientName,
    projectSlugs: preview.projectSlugs,
    removed,
    documentsDigest,
    storage: preview.storage,
    issuedAt,
  };

  await db.insert(schema.destructionCertificates).values({
    userId,
    clientSlug: base.clientSlug,
    clientName: base.clientName,
    projectSlugs: base.projectSlugs,
    removed,
    documentsDigest,
    storage: base.storage,
    issuedAt,
  });

  return { ...base, markdown: renderCertificate(base) };
}

/** Certificates issued for a client, newest first. */
export async function listCertificates(userId: string, clientSlug?: string) {
  const filters = [eq(schema.destructionCertificates.userId, userId)];
  if (clientSlug) filters.push(eq(schema.destructionCertificates.clientSlug, clientSlug));
  return await db
    .select()
    .from(schema.destructionCertificates)
    .where(and(...filters))
    .orderBy(schema.destructionCertificates.issuedAt);
}
