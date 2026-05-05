import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { embed, VoyageError } from "./embeddings";

type FetchFn = typeof fetch;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bodyOfFirstCall(mock: ReturnType<typeof vi.fn<FetchFn>>): {
  url: string;
  method: string | undefined;
  body: { input: string[]; model: string; input_type: string };
} {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("fetch was not called");
  const [input, init] = call;
  const url = typeof input === "string" ? input : input.toString();
  const rawBody = init?.body;
  if (typeof rawBody !== "string") {
    throw new Error("expected init.body to be a string");
  }
  return { url, method: init?.method, body: JSON.parse(rawBody) };
}

beforeEach(() => {
  vi.stubEnv("VOYAGE_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("embed()", () => {
  it("sends input_type=document and the correct payload to Voyage", async () => {
    const fetchMock = vi.fn<FetchFn>(async () =>
      jsonResponse({
        data: [
          { embedding: [0.1, 0.2, 0.3], index: 0 },
          { embedding: [0.4, 0.5, 0.6], index: 1 },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await embed(["alpha", "beta"], "document");

    expect(fetchMock).toHaveBeenCalledOnce();
    const captured = bodyOfFirstCall(fetchMock);
    expect(captured.url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(captured.method).toBe("POST");
    expect(captured.body.input_type).toBe("document");
    expect(captured.body.input).toEqual(["alpha", "beta"]);
    expect(captured.body.model).toBe("voyage-3-large");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([0.1, 0.2, 0.3]);
    expect(result[1]).toEqual([0.4, 0.5, 0.6]);
  });

  it("uses input_type=query when requested", async () => {
    const fetchMock = vi.fn<FetchFn>(async () =>
      jsonResponse({ data: [{ embedding: [1, 2, 3], index: 0 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await embed(["a query"], "query");

    expect(bodyOfFirstCall(fetchMock).body.input_type).toBe("query");
  });

  it("reorders embeddings by their reported index", async () => {
    const fetchMock = vi.fn<FetchFn>(async () =>
      jsonResponse({
        data: [
          { embedding: [9, 9], index: 1 },
          { embedding: [0, 0], index: 0 },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await embed(["a", "b"], "document");
    expect(result[0]).toEqual([0, 0]);
    expect(result[1]).toEqual([9, 9]);
  });

  it("throws VoyageError on non-2xx without retry budget for non-429", async () => {
    const fetchMock = vi.fn<FetchFn>(async () => jsonResponse({ error: "bad key" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(embed(["foo"], "query")).rejects.toBeInstanceOf(VoyageError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns [] for empty input without calling fetch", async () => {
    const fetchMock = vi.fn<FetchFn>();
    vi.stubGlobal("fetch", fetchMock);

    const result = await embed([], "document");

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when VOYAGE_API_KEY is not set", async () => {
    vi.stubEnv("VOYAGE_API_KEY", "");
    await expect(embed(["foo"], "query")).rejects.toThrow(/VOYAGE_API_KEY/);
  });
});
