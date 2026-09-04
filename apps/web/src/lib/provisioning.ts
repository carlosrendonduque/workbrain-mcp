import { schema } from "@workbrain/shared";
import { eq, inArray } from "drizzle-orm";
import type { WorkbrainDb } from "./db";

/**
 * Moving a client from the shared database into one of its own.
 *
 * Three things have to happen and the order matters: the target database
 * needs the schema, then the handful of registry rows the corpus points at,
 * then the corpus itself. Only after the copy is verified does the client
 * row flip to `dedicated` — until it does, the app keeps reading and writing
 * the shared database, so an interrupted move leaves nothing broken.
 */

/**
 * Env var name suggested for a client's dedicated connection string.
 *
 * Takes the SLUG, which is already constrained to lowercase letters, numbers
 * and dashes before any client is created — so this only has to swap dashes
 * for underscores. It validates rather than sanitises: a slug that got past
 * validation is a bug worth seeing, not something to quietly rewrite into a
 * name that no longer matches the client it belongs to.
 *
 * The client's NAME is free text and may contain anything, including accents.
 * It never reaches here.
 */
export function envVarNameForClient(clientSlug: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(clientSlug)) {
    throw new Error(
      `"${clientSlug}" is not a valid client slug (lowercase letters, numbers and dashes). ` +
        "Environment variable names are derived from the slug, not the display name.",
    );
  }
  return `WORKBRAIN_DB_${clientSlug.replace(/-/g, "_").toUpperCase()}`;
}

/**
 * Corpus tables in dependency order — parents first. Copy in this order,
 * delete in the reverse.
 */
export const CORPUS_TABLES = [
  "documents",
  "chunks",
  "document_links",
  "stakeholders",
  "draft_documents",
  "invocations",
] as const;
export type CorpusTable = (typeof CORPUS_TABLES)[number];

export type CorpusCounts = Record<CorpusTable, number>;

export function emptyCounts(): CorpusCounts {
  return {
    documents: 0,
    chunks: 0,
    document_links: 0,
    stakeholders: 0,
    draft_documents: 0,
    invocations: 0,
  };
}

/** True when both sides hold the same number of rows in every table. */
export function countsMatch(a: CorpusCounts, b: CorpusCounts): boolean {
  return CORPUS_TABLES.every((t) => a[t] === b[t]);
}

/** Tables where the two sides disagree, for reporting a failed verification. */
export function countMismatches(
  source: CorpusCounts,
  target: CorpusCounts,
): { table: CorpusTable; source: number; target: number }[] {
  return CORPUS_TABLES.filter((t) => source[t] !== target[t]).map((t) => ({
    table: t,
    source: source[t],
    target: target[t],
  }));
}

export interface NeonProject {
  projectId: string;
  projectName: string;
  connectionUri: string;
}

/**
 * Create a Neon project — one project per dedicated client, because a project
 * is what gets its own compute and its own storage. A separate database
 * inside the shared project would still share both, which is not what we are
 * promising the client.
 */
export async function createNeonProject(args: {
  apiKey: string;
  name: string;
  regionId?: string;
  fetchImpl?: typeof fetch;
}): Promise<NeonProject> {
  const doFetch = args.fetchImpl ?? fetch;
  const body: Record<string, unknown> = { project: { name: args.name } };
  if (args.regionId) {
    (body.project as Record<string, unknown>).region_id = args.regionId;
  }

  const res = await doFetch("https://console.neon.tech/api/v2/projects", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Neon API returned ${res.status} ${res.statusText}: ${detail.slice(0, 400)}`);
  }

  const json = (await res.json()) as {
    project?: { id?: string; name?: string };
    connection_uris?: { connection_uri?: string }[];
  };

  const uri = json.connection_uris?.[0]?.connection_uri;
  if (!uri) {
    throw new Error("Neon API response contained no connection_uris[0].connection_uri");
  }
  return {
    projectId: json.project?.id ?? "(unknown)",
    projectName: json.project?.name ?? args.name,
    connectionUri: uri,
  };
}

export interface RegistryRows {
  client: typeof schema.clients.$inferSelect;
  projects: (typeof schema.projects.$inferSelect)[];
}

/** Read the registry rows a client's corpus points at. */
export async function readRegistry(central: WorkbrainDb, clientId: string): Promise<RegistryRows> {
  const clients = await central
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .limit(1);
  const client = clients[0];
  if (!client) throw new Error(`Client ${clientId} not found in the central database`);

  const projects = await central
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.clientId, clientId));

  return { client, projects };
}

/**
 * Copy the client and project rows into the dedicated database.
 *
 * Nothing reads these — every lookup of a project or client goes to the
 * central registry, which stays authoritative. They exist so the corpus
 * tables' foreign keys resolve, and so a dedicated database is a coherent
 * thing on its own: restorable, and handable to the client. Only the ids
 * matter, and ids never change, so drift in a name is harmless.
 */
export async function replicateRegistry(
  target: WorkbrainDb,
  registry: RegistryRows,
): Promise<void> {
  await target.insert(schema.clients).values(registry.client).onConflictDoNothing();

  // Canon domains are the consultant's own cross-project conventions, not
  // the client's, so they stay central. A project pointing at one would
  // break the foreign key here — null it out in the replica.
  if (registry.projects.length > 0) {
    await target
      .insert(schema.projects)
      .values(registry.projects.map((p) => ({ ...p, domainId: null })))
      .onConflictDoNothing();
  }
}

async function countTable(
  db: WorkbrainDb,
  table: CorpusTable,
  projectIds: string[],
): Promise<number> {
  if (projectIds.length === 0) return 0;
  switch (table) {
    case "documents":
      return (
        await db
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(inArray(schema.documents.projectId, projectIds))
      ).length;
    case "chunks":
      return (
        await db
          .select({ id: schema.chunks.id })
          .from(schema.chunks)
          .where(inArray(schema.chunks.projectId, projectIds))
      ).length;
    case "document_links": {
      const docIds = (
        await db
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(inArray(schema.documents.projectId, projectIds))
      ).map((r) => r.id);
      if (docIds.length === 0) return 0;
      return (
        await db
          .select({ id: schema.documentLinks.id })
          .from(schema.documentLinks)
          .where(inArray(schema.documentLinks.fromDocumentId, docIds))
      ).length;
    }
    case "stakeholders":
      return (
        await db
          .select({ id: schema.stakeholders.id })
          .from(schema.stakeholders)
          .where(inArray(schema.stakeholders.projectId, projectIds))
      ).length;
    case "draft_documents":
      return (
        await db
          .select({ id: schema.draftDocuments.id })
          .from(schema.draftDocuments)
          .where(inArray(schema.draftDocuments.projectId, projectIds))
      ).length;
    case "invocations":
      return (
        await db
          .select({ id: schema.invocations.id })
          .from(schema.invocations)
          .where(inArray(schema.invocations.projectId, projectIds))
      ).length;
  }
}

/** Row counts for one client's corpus in whichever database is passed. */
export async function countCorpus(db: WorkbrainDb, projectIds: string[]): Promise<CorpusCounts> {
  const counts = emptyCounts();
  for (const table of CORPUS_TABLES) {
    counts[table] = await countTable(db, table, projectIds);
  }
  return counts;
}

// Chunks carry a 1024-dimension vector each, so they move in smaller batches
// than the rest to keep each statement well inside the HTTP payload limit.
const BATCH = 400;
const CHUNK_BATCH = 50;

async function insertInBatches<T>(
  rows: T[],
  size: number,
  insert: (batch: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await insert(rows.slice(i, i + size));
  }
}

/**
 * Copy one client's corpus from one database to another.
 *
 * Idempotent: every insert ignores conflicts on the primary key, so an
 * interrupted run can simply be run again. Nothing is deleted from the
 * source here — that is a separate, explicit step after verification.
 */
export async function copyCorpus(args: {
  source: WorkbrainDb;
  target: WorkbrainDb;
  projectIds: string[];
  onProgress?: (table: CorpusTable, copied: number) => void;
}): Promise<CorpusCounts> {
  const { source, target, projectIds } = args;
  const copied = emptyCounts();
  if (projectIds.length === 0) return copied;

  const documents = await source
    .select()
    .from(schema.documents)
    .where(inArray(schema.documents.projectId, projectIds));
  await insertInBatches(documents, BATCH, (b) =>
    target.insert(schema.documents).values(b).onConflictDoNothing(),
  );
  copied.documents = documents.length;
  args.onProgress?.("documents", documents.length);

  const chunks = await source
    .select()
    .from(schema.chunks)
    .where(inArray(schema.chunks.projectId, projectIds));
  await insertInBatches(chunks, CHUNK_BATCH, (b) =>
    target.insert(schema.chunks).values(b).onConflictDoNothing(),
  );
  copied.chunks = chunks.length;
  args.onProgress?.("chunks", chunks.length);

  const documentIds = documents.map((d) => d.id);
  if (documentIds.length > 0) {
    const links = await source
      .select()
      .from(schema.documentLinks)
      .where(inArray(schema.documentLinks.fromDocumentId, documentIds));
    await insertInBatches(links, BATCH, (b) =>
      target.insert(schema.documentLinks).values(b).onConflictDoNothing(),
    );
    copied.document_links = links.length;
    args.onProgress?.("document_links", links.length);
  }

  const stakeholders = await source
    .select()
    .from(schema.stakeholders)
    .where(inArray(schema.stakeholders.projectId, projectIds));
  await insertInBatches(stakeholders, BATCH, (b) =>
    target.insert(schema.stakeholders).values(b).onConflictDoNothing(),
  );
  copied.stakeholders = stakeholders.length;
  args.onProgress?.("stakeholders", stakeholders.length);

  const drafts = await source
    .select()
    .from(schema.draftDocuments)
    .where(inArray(schema.draftDocuments.projectId, projectIds));
  await insertInBatches(drafts, BATCH, (b) =>
    target.insert(schema.draftDocuments).values(b).onConflictDoNothing(),
  );
  copied.draft_documents = drafts.length;
  args.onProgress?.("draft_documents", drafts.length);

  const invocations = await source
    .select()
    .from(schema.invocations)
    .where(inArray(schema.invocations.projectId, projectIds));
  await insertInBatches(invocations, BATCH, (b) =>
    target.insert(schema.invocations).values(b).onConflictDoNothing(),
  );
  copied.invocations = invocations.length;
  args.onProgress?.("invocations", invocations.length);

  return copied;
}

/**
 * Delete one client's corpus from a database. Reverse dependency order.
 *
 * Only ever called against the source after a verified copy, or to destroy a
 * client's data at the end of an engagement.
 */
export async function purgeCorpus(db: WorkbrainDb, projectIds: string[]): Promise<CorpusCounts> {
  if (projectIds.length === 0) return emptyCounts();

  // Counted before deleting so the caller can report what was destroyed —
  // which is exactly what an end-of-engagement certificate needs to say.
  const removed = await countCorpus(db, projectIds);

  const documentIds = (
    await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(inArray(schema.documents.projectId, projectIds))
  ).map((r) => r.id);

  await db.delete(schema.invocations).where(inArray(schema.invocations.projectId, projectIds));
  await db
    .delete(schema.draftDocuments)
    .where(inArray(schema.draftDocuments.projectId, projectIds));
  await db.delete(schema.stakeholders).where(inArray(schema.stakeholders.projectId, projectIds));
  if (documentIds.length > 0) {
    await db
      .delete(schema.documentLinks)
      .where(inArray(schema.documentLinks.fromDocumentId, documentIds));
    await db
      .delete(schema.documentLinks)
      .where(inArray(schema.documentLinks.toDocumentId, documentIds));
  }
  await db.delete(schema.chunks).where(inArray(schema.chunks.projectId, projectIds));
  await db.delete(schema.documents).where(inArray(schema.documents.projectId, projectIds));

  return removed;
}

/** Flip the client to dedicated. Only ever after a verified copy. */
export async function markDedicated(
  central: WorkbrainDb,
  clientId: string,
  envVarName: string,
): Promise<void> {
  await central
    .update(schema.clients)
    .set({ isolationMode: "dedicated", corpusDbUrlEnv: envVarName })
    .where(eq(schema.clients.id, clientId));
}
