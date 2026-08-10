import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ComposeError, GetCanonInputSchema, getCanon } from "@/lib/compose";

export const runtime = "nodejs";

function errorResponse(
  code: string,
  message: string,
  status: number,
  detail?: unknown,
): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message, detail } }, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const h = await headers();
  const userId = h.get("x-user-id");
  if (!userId) {
    return errorResponse("unauthorized", "Missing user context.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "Request body is not valid JSON.", 400);
  }

  const parsed = GetCanonInputSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "invalid_input",
      "Request body did not match the get_canon schema.",
      400,
      z.treeifyError(parsed.error),
    );
  }

  try {
    const result = await getCanon(userId, parsed.data);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof ComposeError) {
      return errorResponse(err.code, err.message, err.status);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("get_canon failed:", err);
    return errorResponse("get_canon_failed", message, 500);
  }
}
