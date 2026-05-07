import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { extractBearerKey, hashApiKey } from "./lib/auth";
import { db, schema } from "./lib/db";
import { SESSION_COOKIE, verifySession } from "./lib/session";

export const config = {
  // Apply to /api/*, the dashboard and any future webapp surface. Static assets
  // and Next internals are excluded by Next's default matcher behavior, but
  // /login is intentionally NOT listed here — its page handles its own session
  // check and redirects an already-authenticated user.
  matcher: [
    "/api/:path*",
    "/dashboard/:path*",
    "/projects/:path*",
    "/drafts/:path*",
    "/audit/:path*",
    "/account/:path*",
  ],
};

function unauthorizedJson(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: "unauthorized", message } },
    { status: 401 },
  );
}

async function handleApi(request: NextRequest): Promise<NextResponse> {
  const rawKey = extractBearerKey(request.headers.get("authorization"));
  if (!rawKey) {
    return unauthorizedJson("Missing or malformed Authorization header.");
  }

  const keyHash = await hashApiKey(rawKey);
  const rows = await db
    .select({ id: schema.apiKeys.id, userId: schema.apiKeys.userId })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.keyHash, keyHash))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return unauthorizedJson("Invalid API key.");
  }

  await db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, row.id));

  const headers = new Headers(request.headers);
  headers.set("x-user-id", row.userId);

  return NextResponse.next({ request: { headers } });
}

async function handleWebapp(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return handleApi(request);
  }
  return handleWebapp(request);
}
