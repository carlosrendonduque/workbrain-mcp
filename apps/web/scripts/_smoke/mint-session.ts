import "dotenv/config";
import { webcrypto } from "node:crypto";

// Node 18 lacks globalThis.crypto; jose 6.x and our SubtleCrypto calls need it.
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { SignJWT } from "jose";
import { schema } from "@workbrain/shared";

const KEY = process.argv[2];
if (!KEY) {
  console.error("usage: mint-session.ts <wbk_key>");
  process.exit(1);
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const buf = new ArrayBuffer(hex.length / 2);
  const view = new Uint8Array(buf);
  for (let i = 0; i < view.length; i += 1) {
    view[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return buf;
}

function bytesToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  return out;
}

const saltHex = process.env.WORKBRAIN_API_KEYS_SALT;
const sessionHex = process.env.WORKBRAIN_SESSION_SECRET;
const dbUrl = process.env.DATABASE_URL;
if (!saltHex || !sessionHex || !dbUrl) {
  console.error("missing env (WORKBRAIN_API_KEYS_SALT / WORKBRAIN_SESSION_SECRET / DATABASE_URL)");
  process.exit(1);
}

const SALT_BUFFER = hexToArrayBuffer(saltHex);
const SESSION_KEY = new Uint8Array(hexToArrayBuffer(sessionHex));

async function hashApiKey(raw: string): Promise<string> {
  const km = await crypto.subtle.importKey(
    "raw",
    SALT_BUFFER,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const msgBuf = new ArrayBuffer(raw.length);
  const msgView = new Uint8Array(msgBuf);
  for (let i = 0; i < raw.length; i += 1) msgView[i] = raw.charCodeAt(i);
  const sig = await crypto.subtle.sign("HMAC", km, msgBuf);
  return bytesToHex(sig);
}

const sql = neon(dbUrl);
const db = drizzle(sql, { schema });

const hash = await hashApiKey(KEY);
const rows = await db
  .select({
    apiKeyId: schema.apiKeys.id,
    userId: schema.apiKeys.userId,
    email: schema.users.email,
  })
  .from(schema.apiKeys)
  .innerJoin(schema.users, eq(schema.apiKeys.userId, schema.users.id))
  .where(eq(schema.apiKeys.keyHash, hash))
  .limit(1);

const row = rows[0];
if (!row) {
  console.error("key not in api_keys table");
  process.exit(2);
}

const token = await new SignJWT({ email: row.email, apiKeyId: row.apiKeyId })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuer("workbrain")
  .setAudience("workbrain-webapp")
  .setSubject(row.userId)
  .setIssuedAt()
  .setExpirationTime("30d")
  .sign(SESSION_KEY);

console.log(token);
