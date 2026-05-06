// Server-only auth helpers for App Router pages and Server Actions. Wraps
// next/headers cookies() with jose verification.
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hashApiKey } from "./auth";
import { db, schema } from "./db";
import {
  SESSION_COOKIE,
  type SessionPayload,
  buildClearedSessionCookie,
  buildSessionCookie,
  signSession,
  verifySession,
} from "./session";

export async function readSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export interface ResolvedKey {
  apiKeyId: string;
  userId: string;
  email: string;
}

export async function resolveApiKey(rawKey: string): Promise<ResolvedKey | null> {
  const keyHash = await hashApiKey(rawKey);
  const rows = await db
    .select({
      apiKeyId: schema.apiKeys.id,
      userId: schema.apiKeys.userId,
      email: schema.users.email,
    })
    .from(schema.apiKeys)
    .innerJoin(schema.users, eq(schema.apiKeys.userId, schema.users.id))
    .where(eq(schema.apiKeys.keyHash, keyHash))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  await db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, row.apiKeyId));

  return row;
}

export async function startSession(payload: SessionPayload): Promise<void> {
  const token = await signSession(payload);
  const attrs = buildSessionCookie(token);
  const jar = await cookies();
  jar.set(attrs);
}

export async function clearSession(): Promise<void> {
  const attrs = buildClearedSessionCookie();
  const jar = await cookies();
  jar.set(attrs);
}
