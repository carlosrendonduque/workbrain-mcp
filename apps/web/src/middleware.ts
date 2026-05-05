import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db, schema } from "./lib/db";
import { extractBearerKey, hashApiKey } from "./lib/auth";

export const config = {
  matcher: ["/api/:path*"],
};

function unauthorized(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: "unauthorized", message } },
    { status: 401 },
  );
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const rawKey = extractBearerKey(request.headers.get("authorization"));
  if (!rawKey) {
    return unauthorized("Missing or malformed Authorization header.");
  }

  const keyHash = await hashApiKey(rawKey);
  const rows = await db
    .select({ id: schema.apiKeys.id, userId: schema.apiKeys.userId })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.keyHash, keyHash))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return unauthorized("Invalid API key.");
  }

  await db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, row.id));

  const headers = new Headers(request.headers);
  headers.set("x-user-id", row.userId);

  return NextResponse.next({ request: { headers } });
}
