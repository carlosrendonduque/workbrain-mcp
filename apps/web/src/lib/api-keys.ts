import { and, desc, eq } from "drizzle-orm";
import { hashApiKey } from "./auth";
import { db, schema } from "./db";

export interface ApiKeyRow {
  apiKeyId: string;
  label: string;
  hashFingerprint: string;
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
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
    })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.userId, userId))
    .orderBy(desc(schema.apiKeys.createdAt));

  return rows.map((r) => ({
    apiKeyId: r.apiKeyId,
    label: r.label,
    hashFingerprint: r.keyHash.slice(0, 12),
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
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
}

export async function createApiKey(userId: string, label: string): Promise<CreatedApiKey> {
  if (label.trim().length === 0) {
    throw new ApiKeyError("missing_label", "Label is required.", 400);
  }
  const rawKey = generateRawKey();
  const keyHash = await hashApiKey(rawKey);
  const inserted = await db
    .insert(schema.apiKeys)
    .values({ userId, keyHash, label: label.trim() })
    .returning({ id: schema.apiKeys.id });
  const row = inserted[0];
  if (!row) {
    throw new ApiKeyError("insert_failed", "Failed to insert API key.", 500);
  }
  return { apiKeyId: row.id, rawKey, label: label.trim() };
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
