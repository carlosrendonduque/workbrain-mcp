// Edge-compatible session helpers. Pure jose, no next/headers — usable from
// middleware. Cookie reads/writes that need next/headers live in webapp-auth.ts.
import { SignJWT, jwtVerify } from "jose";

const secretHex = process.env.WORKBRAIN_SESSION_SECRET;
if (!secretHex) {
  throw new Error("WORKBRAIN_SESSION_SECRET is not set");
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const SECRET_KEY = hexToUint8Array(secretHex);
const ISSUER = "workbrain";
const AUDIENCE = "workbrain-webapp";

export const SESSION_COOKIE = "wb_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  userId: string;
  email: string;
  apiKeyId: string;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email, apiKeyId: payload.apiKeyId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(SECRET_KEY);
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET_KEY, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.apiKeyId !== "string"
    ) {
      return null;
    }
    return { userId: payload.sub, email: payload.email, apiKeyId: payload.apiKeyId };
  } catch {
    return null;
  }
}

export interface CookieAttributes {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

export function buildSessionCookie(token: string): CookieAttributes {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function buildClearedSessionCookie(): CookieAttributes {
  return {
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  };
}
