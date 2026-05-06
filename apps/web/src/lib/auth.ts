// Edge-compatible auth helpers. Uses Web Crypto (available in Edge runtime,
// Node 20+, and modern browsers) so the same code path runs in middleware.

const saltHex = process.env.WORKBRAIN_API_KEYS_SALT;
if (!saltHex) {
  throw new Error("WORKBRAIN_API_KEYS_SALT is not set");
}

const BEARER_PATTERN = /^Bearer\s+(wbk_[a-f0-9]{64})$/;

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
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

const SALT_BYTES = hexToBytes(saltHex);

export async function hashApiKey(rawKey: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    SALT_BYTES,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const encoded = new TextEncoder().encode(rawKey);
  const message = new Uint8Array(new ArrayBuffer(encoded.length));
  message.set(encoded);
  const signature = await crypto.subtle.sign("HMAC", keyMaterial, message);
  return bytesToHex(signature);
}

export function extractBearerKey(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = BEARER_PATTERN.exec(headerValue);
  return match?.[1] ?? null;
}
