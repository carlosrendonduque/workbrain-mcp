import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { callerFromHeaders } from "@/lib/caller";
import { z } from "zod";
import { IngestError, IngestPasteInputSchema, ingestPaste } from "@/lib/paste";

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
  const caller = callerFromHeaders(h);
  if (!caller) {
    return errorResponse("unauthorized", "Missing user context.", 401);
  }
  const { userId, clientScope } = caller;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "Request body is not valid JSON.", 400);
  }

  const parsed = IngestPasteInputSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "invalid_input",
      "Request body did not match the ingest_paste schema.",
      400,
      z.treeifyError(parsed.error),
    );
  }

  try {
    const result = await ingestPaste(userId, parsed.data, { sessionId: null, clientScope });
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof IngestError) {
      return errorResponse(err.code, err.message, err.status);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("ingest_paste failed:", err);
    return errorResponse("ingest_failed", message, 500);
  }
}
