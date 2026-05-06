import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClassifierError, classify } from "./classifier";

function makeMockClient(message: Anthropic.Message): Anthropic {
  const create = vi.fn().mockResolvedValue(message);
  return { messages: { create } } as unknown as Anthropic;
}

function toolUseMessage(input: unknown): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: [
      {
        type: "tool_use",
        id: "toolu_test",
        name: "classify_document",
        input,
      } as Anthropic.ToolUseBlock,
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      service_tier: "standard",
    },
  } as unknown as Anthropic.Message;
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("classify()", () => {
  it("parses a valid tool_use response into a ClassifierResult", async () => {
    const message = toolUseMessage({
      type: "ticket",
      externalId: "TICKET-1234",
      references: ["TICKET-1230"],
      detectedDate: "2026-05-06",
      reasoning: "Has a Jira-style ID and status.",
    });
    const client = makeMockClient(message);

    const out = await classify("TICKET-1234 ...body...", { client });

    expect(out.result.type).toBe("ticket");
    expect(out.result.externalId).toBe("TICKET-1234");
    expect(out.result.references).toEqual(["TICKET-1230"]);
    expect(out.result.detectedDate).toBe("2026-05-06");
    expect(out.usage.inputTokens).toBe(100);
    expect(out.model).toBe("claude-sonnet-4-6");
  });

  it("uses claude-sonnet-4-6, low effort, disabled thinking, and forced tool choice", async () => {
    const message = toolUseMessage({ type: "note", references: [] });
    const client = makeMockClient(message);

    await classify("a short note", { client });

    const create = client.messages.create as unknown as ReturnType<typeof vi.fn>;
    expect(create).toHaveBeenCalledOnce();
    const args = create.mock.calls[0]?.[0];
    expect(args.model).toBe("claude-sonnet-4-6");
    expect(args.thinking).toEqual({ type: "disabled" });
    expect(args.output_config).toEqual({ effort: "low" });
    expect(args.tool_choice).toEqual({ type: "tool", name: "classify_document" });
    expect(args.system?.[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(args.tools?.[0]?.name).toBe("classify_document");
    expect(args.tools?.[0]?.input_schema?.properties?.type?.enum).toContain("ticket");
  });

  it("throws ClassifierError when the model does not call the tool", async () => {
    const message = {
      ...toolUseMessage({}),
      content: [{ type: "text", text: "I refuse to classify." }] as unknown,
      stop_reason: "end_turn",
    } as unknown as Anthropic.Message;
    const client = makeMockClient(message);

    await expect(classify("foo", { client })).rejects.toBeInstanceOf(ClassifierError);
  });

  it("throws ClassifierError when the tool input fails schema validation", async () => {
    const client = makeMockClient(toolUseMessage({ type: "not_a_real_type", references: [] }));

    await expect(classify("foo", { client })).rejects.toMatchObject({
      name: "ClassifierError",
      code: "malformed_tool_input",
    });
  });

  it("throws ClassifierError(empty_input) on whitespace-only text", async () => {
    const client = makeMockClient(toolUseMessage({ type: "note", references: [] }));

    await expect(classify("   \n   \t  ", { client })).rejects.toMatchObject({
      code: "empty_input",
      status: 400,
    });
  });

  it("normalizes references to [] when omitted", async () => {
    const client = makeMockClient(toolUseMessage({ type: "note" }));

    const out = await classify("a note", { client });
    expect(out.result.references).toEqual([]);
  });
});
