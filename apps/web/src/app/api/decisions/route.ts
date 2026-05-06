import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { RecordDecisionInputSchema, recordDecision } from "@/lib/decisions";
import { IngestError } from "@/lib/paste";

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

  const parsed = RecordDecisionInputSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "invalid_input",
      "Request body did not match the record_decision schema.",
      400,
      z.treeifyError(parsed.error),
    );
  }

  try {
    const result = await recordDecision(userId, parsed.data);
    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof IngestError) {
      return errorResponse(err.code, err.message, err.status);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("record_decision failed:", err);
    return errorResponse("decision_failed", message, 500);
  }
}
