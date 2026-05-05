// Edge-compatible auth helpers. Uses Web Crypto (available in Edge runtime,
// Node 20+, and modern browsers) so the same code path runs in middleware.

const saltHex = process.env.WORKBRAIN_API_KEYS_SALT;
if (!saltHex) {
  throw new Error("WORKBRAIN_API_KEYS_SALT is not set");
}

const BEARER_PATTERN = /^Bearer\s+(wbk_[a-f0-9]{64})$/;

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const buffer = new ArrayBuffer(hex.length / 2);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < view.length; i += 1) {
    view[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return buffer;
}

function bytesToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

const SALT_BUFFER = hexToArrayBuffer(saltHex);

export async function hashApiKey(rawKey: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    SALT_BUFFER,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const messageBuffer = new ArrayBuffer(rawKey.length);
  const messageView = new Uint8Array(messageBuffer);
  for (let i = 0; i < rawKey.length; i += 1) {
    messageView[i] = rawKey.charCodeAt(i);
  }
  const signature = await crypto.subtle.sign("HMAC", keyMaterial, messageBuffer);
  return bytesToHex(signature);
}

export function extractBearerKey(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = BEARER_PATTERN.exec(headerValue);
  return match?.[1] ?? null;
}
