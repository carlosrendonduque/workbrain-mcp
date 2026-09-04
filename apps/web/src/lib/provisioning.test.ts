import { describe, expect, it, vi } from "vitest";
import {
  CORPUS_TABLES,
  type CorpusCounts,
  countMismatches,
  countsMatch,
  createNeonProject,
  emptyCounts,
  envVarNameForClient,
} from "./provisioning";

describe("envVarNameForClient", () => {
  it("builds a shouty env var name from a slug", () => {
    expect(envVarNameForClient("leozenit")).toBe("WORKBRAIN_DB_LEOZENIT");
  });

  it("turns dashes into underscores", () => {
    expect(envVarNameForClient("acme-finance")).toBe("WORKBRAIN_DB_ACME_FINANCE");
  });

  // Slugs are validated as [a-z0-9-] before any client exists, so anything
  // else arriving here means something upstream is broken. Rewriting it
  // would produce a name that no longer matches the client it belongs to.
  it("rejects a display name instead of quietly rewriting it", () => {
    expect(() => envVarNameForClient("Café Central")).toThrow(/not a valid client slug/);
  });

  it("rejects a slug with a leading or trailing dash", () => {
    expect(() => envVarNameForClient("-acme-")).toThrow();
  });

  it("rejects an empty slug", () => {
    expect(() => envVarNameForClient("")).toThrow();
  });
});

function counts(over: Partial<CorpusCounts> = {}): CorpusCounts {
  return { ...emptyCounts(), ...over };
}

describe("countsMatch / countMismatches", () => {
  it("matches when every table agrees", () => {
    const a = counts({ documents: 3, chunks: 40, invocations: 7 });
    const b = counts({ documents: 3, chunks: 40, invocations: 7 });
    expect(countsMatch(a, b)).toBe(true);
    expect(countMismatches(a, b)).toEqual([]);
  });

  it("matches two empty corpora", () => {
    expect(countsMatch(emptyCounts(), emptyCounts())).toBe(true);
  });

  // The whole point of verification: a copy that dropped rows must not be
  // reported as complete, or the switch-over loses data.
  it("fails when the target is short by even one row", () => {
    const source = counts({ documents: 3, chunks: 40 });
    const target = counts({ documents: 3, chunks: 39 });
    expect(countsMatch(source, target)).toBe(false);
    expect(countMismatches(source, target)).toEqual([{ table: "chunks", source: 40, target: 39 }]);
  });

  it("reports every table that disagrees", () => {
    const source = counts({ documents: 3, chunks: 40, stakeholders: 2 });
    const target = counts({ documents: 1, chunks: 40, stakeholders: 0 });
    expect(countMismatches(source, target).map((m) => m.table)).toEqual([
      "documents",
      "stakeholders",
    ]);
  });

  it("covers every corpus table", () => {
    expect(Object.keys(emptyCounts()).sort()).toEqual([...CORPUS_TABLES].sort());
  });
});

function jsonResponse(payload: unknown, status = 201): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createNeonProject", () => {
  const OK = {
    project: { id: "wandering-fog-123", name: "workbrain-acme" },
    connection_uris: [{ connection_uri: "postgresql://u:p@ep-x.aws.neon.tech/neondb" }],
  };

  it("posts to the projects endpoint with the api key", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(OK));
    await createNeonProject({ apiKey: "napi_test", name: "workbrain-acme", fetchImpl });

    const call = fetchImpl.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const [url, init] = call;
    expect(String(url)).toBe("https://console.neon.tech/api/v2/projects");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer napi_test");
    expect(JSON.parse(String(init?.body))).toEqual({ project: { name: "workbrain-acme" } });
  });

  it("passes the region through when one is given", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(OK));
    await createNeonProject({
      apiKey: "napi_test",
      name: "workbrain-acme",
      regionId: "aws-ap-southeast-2",
      fetchImpl,
    });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.project.region_id).toBe("aws-ap-southeast-2");
  });

  it("returns the connection uri and project id", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(OK));
    const out = await createNeonProject({ apiKey: "k", name: "n", fetchImpl });
    expect(out.projectId).toBe("wandering-fog-123");
    expect(out.connectionUri).toBe("postgresql://u:p@ep-x.aws.neon.tech/neondb");
  });

  it("throws with the status and body when Neon rejects the request", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("quota exceeded", { status: 422 }));
    await expect(createNeonProject({ apiKey: "k", name: "n", fetchImpl })).rejects.toThrow(
      /422.*quota exceeded/s,
    );
  });

  it("throws rather than returning an empty connection string", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ project: { id: "x" }, connection_uris: [] }));
    await expect(createNeonProject({ apiKey: "k", name: "n", fetchImpl })).rejects.toThrow(
      /connection_uri/,
    );
  });
});
