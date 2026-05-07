import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  JSONRPC_INVALID_REQUEST,
  JSONRPC_PARSE_ERROR,
  handleJsonRpcRequest,
} from "@/lib/mcp/handler";

export const runtime = "nodejs";

// JSON-RPC error envelope returned BEFORE we have a parsed id.
function bareError(code: number, message: string): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code, message } },
    { status: 200 },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const h = await headers();
  const userId = h.get("x-user-id");
  if (!userId) {
    // Middleware should have populated this — defensive only.
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized." } },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return bareError(JSONRPC_PARSE_ERROR, "Body is not valid JSON.");
  }

  // Support batch requests per JSON-RPC spec.
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return bareError(JSONRPC_INVALID_REQUEST, "Empty batch.");
    }
    const responses = await Promise.all(body.map((item) => handleJsonRpcRequest(userId, item)));
    const filtered = responses.filter((r) => r !== null);
    if (filtered.length === 0) return new NextResponse(null, { status: 204 });
    return NextResponse.json(filtered);
  }

  const response = await handleJsonRpcRequest(userId, body);
  if (response === null) {
    // Notification — no response per JSON-RPC spec.
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json(response);
}

// MCP Streamable HTTP also accepts GET to open an SSE channel for
// server-initiated messages. We don't push anything yet, so respond with 405.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "method_not_allowed", message: "Server does not initiate messages." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
