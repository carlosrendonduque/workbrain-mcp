// Minimal MCP-over-HTTP dispatcher implementing JSON-RPC 2.0 with the methods
// our IDE agents need: initialize, notifications/initialized, tools/list,
// tools/call. Streamable HTTP transport per the MCP spec, stateless variant —
// each request is independent, no session tracking.

import { z } from "zod";
import { MCP_INSTRUCTIONS } from "./instructions";
import { TOOLS, findTool } from "./tools";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "workbrain", version: "0.1.0" };

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.jsonrpc === "2.0" && typeof v.method === "string";
}

function success(id: string | number | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function failure(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function toJsonSchema(schema: z.ZodTypeAny): unknown {
  // Strip the `$schema` field that Zod emits — MCP clients don't need it and
  // it tends to confuse strict consumers.
  const json = z.toJSONSchema(schema, { target: "draft-7" });
  if (typeof json === "object" && json !== null && "$schema" in json) {
    const { $schema: _ignored, ...rest } = json as Record<string, unknown>;
    return rest;
  }
  return json;
}

function buildToolsList(): unknown {
  return {
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: toJsonSchema(t.schema),
    })),
  };
}

interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

function isToolCallParams(value: unknown): value is ToolCallParams {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === "string";
}

function toolResult(payload: unknown, isError: boolean): unknown {
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
    isError,
  };
}

async function dispatchToolCall(
  userId: string,
  params: unknown,
): Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }> {
  if (!isToolCallParams(params)) {
    return { error: { code: JSONRPC_INVALID_PARAMS, message: "Invalid tool call params." } };
  }
  const tool = findTool(params.name);
  if (!tool) {
    return {
      error: {
        code: JSONRPC_METHOD_NOT_FOUND,
        message: `Unknown tool: ${params.name}`,
      },
    };
  }

  const parsed = tool.schema.safeParse(params.arguments ?? {});
  if (!parsed.success) {
    return {
      result: toolResult(
        {
          error: "invalid_input",
          detail: z.treeifyError(parsed.error),
        },
        true,
      ),
    };
  }

  try {
    const out = await tool.handler(userId, parsed.data);
    return { result: toolResult(out, false) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: toolResult({ error: "tool_failed", message }, true) };
  }
}

export async function handleJsonRpcRequest(
  userId: string,
  body: unknown,
): Promise<JsonRpcResponse | null> {
  if (!isJsonRpcRequest(body)) {
    return failure(null, JSONRPC_INVALID_REQUEST, "Invalid JSON-RPC envelope.");
  }
  const id = body.id ?? null;

  // Notifications (no id) get no response per the JSON-RPC spec.
  const isNotification = body.id === undefined || body.id === null;

  switch (body.method) {
    case "initialize":
      return success(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: MCP_INSTRUCTIONS,
      });

    case "notifications/initialized":
    case "initialized":
      return null; // notification, no response

    case "ping":
      return success(id, {});

    case "tools/list":
      return success(id, buildToolsList());

    case "tools/call": {
      const out = await dispatchToolCall(userId, body.params);
      if (out.error) {
        return failure(id, out.error.code, out.error.message, out.error.data);
      }
      return success(id, out.result);
    }

    default:
      if (isNotification) return null;
      return failure(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${body.method}`);
  }
}
