import { and, desc, eq } from "drizzle-orm";
import { hashApiKey } from "./auth";
import { db, schema } from "./db";

export interface ApiKeyRow {
  apiKeyId: string;
  label: string;
  hashFingerprint: string;
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
  /** null when the key may reach every client the user owns. */
  clientId: string | null;
  clientSlug: string | null;
  clientName: string | null;
}

export class ApiKeyError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiKeyError";
    this.code = code;
    this.status = status;
  }
}

export async function listApiKeys(userId: string): Promise<ApiKeyRow[]> {
  const rows = await db
    .select({
      apiKeyId: schema.apiKeys.id,
      label: schema.apiKeys.label,
      keyHash: schema.apiKeys.keyHash,
      createdAt: schema.apiKeys.createdAt,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      clientId: schema.apiKeys.clientId,
      clientSlug: schema.clients.slug,
      clientName: schema.clients.name,
    })
    .from(schema.apiKeys)
    .leftJoin(schema.clients, eq(schema.clients.id, schema.apiKeys.clientId))
    .where(eq(schema.apiKeys.userId, userId))
    .orderBy(desc(schema.apiKeys.createdAt));

  return rows.map((r) => ({
    apiKeyId: r.apiKeyId,
    label: r.label,
    hashFingerprint: r.keyHash.slice(0, 12),
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    clientId: r.clientId,
    clientSlug: r.clientSlug,
    clientName: r.clientName,
  }));
}

function generateRawKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `wbk_${hex}`;
}

export interface CreatedApiKey {
  apiKeyId: string;
  rawKey: string;
  label: string;
  clientSlug: string | null;
}

/**
 * Mint a key. Passing a clientId pins it to that client and nothing else,
 * which is what you want for the key that lives in one client's repo: if that
 * laptop is lost, the blast radius is that client rather than all of them.
 * Omit it for a key that may reach every client the user owns.
 */
export async function createApiKey(
  userId: string,
  label: string,
  clientId?: string | null,
): Promise<CreatedApiKey> {
  if (label.trim().length === 0) {
    throw new ApiKeyError("missing_label", "Label is required.", 400);
  }

  let clientSlug: string | null = null;
  if (clientId) {
    // Confirm the client belongs to this user before pinning to it —
    // otherwise a crafted form could mint a key naming someone else's client.
    const owned = await db
      .select({ slug: schema.clients.slug })
      .from(schema.clients)
      .where(and(eq(schema.clients.id, clientId), eq(schema.clients.userId, userId)))
      .limit(1);
    const row = owned[0];
    if (!row) {
      throw new ApiKeyError("client_not_found", "That client does not exist for this user.", 404);
    }
    clientSlug = row.slug;
  }

  const rawKey = generateRawKey();
  const keyHash = await hashApiKey(rawKey);
  const inserted = await db
    .insert(schema.apiKeys)
    .values({ userId, keyHash, label: label.trim(), clientId: clientId ?? null })
    .returning({ id: schema.apiKeys.id });
  const row = inserted[0];
  if (!row) {
    throw new ApiKeyError("insert_failed", "Failed to insert API key.", 500);
  }
  return { apiKeyId: row.id, rawKey, label: label.trim(), clientSlug };
}

export async function revokeApiKey(userId: string, apiKeyId: string): Promise<void> {
  const result = await db
    .delete(schema.apiKeys)
    .where(and(eq(schema.apiKeys.id, apiKeyId), eq(schema.apiKeys.userId, userId)))
    .returning({ id: schema.apiKeys.id });
  if (result.length === 0) {
    throw new ApiKeyError("not_found", "API key not found or not owned by user.", 404);
  }
}

export async function countApiKeys(userId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.apiKeys.id })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.userId, userId));
  return rows.length;
}
