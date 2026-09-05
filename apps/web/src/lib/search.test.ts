import { beforeAll, describe, expect, it } from "vitest";

/**
 * The invariant these tests exist for: a corpus search is restricted to one
 * project, always, whatever else the caller asks for.
 *
 * They render the real query through drizzle's `.toSQL()` — no database is
 * contacted and none is needed — so what is asserted is the SQL the
 * application actually sends, not a reimplementation of it. Before this file
 * existed, the only thing protecting the product's central promise from a
 * careless refactor was a comment in the source.
 */

const CENTRAL_URL = "postgresql://u:p@central.example.neon.tech/main?sslmode=require";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "22222222-2222-4222-8222-222222222222";

type SearchModule = typeof import("./search");
type DbModule = typeof import("./db");
let searchMod: SearchModule;
let dbMod: DbModule;

// A 1024-dimension vector is what voyage-3-large returns; the values are
// irrelevant here, only that the query builds around them.
const VEC = new Array(1024).fill(0.1);

beforeAll(async () => {
  process.env.DATABASE_URL = CENTRAL_URL;
  dbMod = await import("./db");
  searchMod = await import("./search");
});

function lexicalSqlFor(
  input: Parameters<SearchModule["buildLexicalQuery"]>[0]["input"],
  projectId = PROJECT,
) {
  return searchMod
    .buildLexicalQuery({
      corpusDb: dbMod.db,
      projectId,
      query: "ACME-1042 rate limiting",
      limit: 8,
      input,
    })
    .toSQL();
}

function sqlFor(
  input: Parameters<SearchModule["buildChunkQuery"]>[0]["input"],
  projectId = PROJECT,
) {
  return searchMod
    .buildChunkQuery({
      corpusDb: dbMod.db,
      projectId,
      queryVec: VEC,
      minSimilarity: 0.3,
      limit: 8,
      input,
    })
    .toSQL();
}

// Every shape a caller can ask for, including all filters at once.
const INPUTS: { name: string; input: Parameters<typeof sqlFor>[0] }[] = [
  { name: "no filters", input: {} },
  { name: "type filter", input: { types: ["ticket", "decision"] } },
  { name: "externalId filter", input: { externalId: "ACME-1042" } },
  { name: "dateRange from", input: { dateRange: { from: "2026-01-01" } } },
  { name: "dateRange to", input: { dateRange: { to: "2026-06-30" } } },
  { name: "dateRange both", input: { dateRange: { from: "2026-01-01", to: "2026-06-30" } } },
  { name: "empty types array", input: { types: [] } },
  {
    name: "everything at once",
    input: {
      types: ["ticket"],
      externalId: "ACME-1042",
      dateRange: { from: "2026-01-01", to: "2026-06-30" },
    },
  },
];

describe("buildChunkQuery — the project filter is not optional", () => {
  for (const { name, input } of INPUTS) {
    it(`filters by project_id with ${name}`, () => {
      const { sql, params } = sqlFor(input);
      expect(sql).toContain('"chunks"."project_id" =');
      expect(params).toContain(PROJECT);
    });
  }

  it("never mentions another project's id", () => {
    for (const { input } of INPUTS) {
      const { params } = sqlFor(input);
      expect(params).not.toContain(OTHER_PROJECT);
    }
  });

  it("binds the project id as a parameter rather than interpolating it", () => {
    // Interpolated ids would be an injection surface and would also break
    // the assertion above, so pin the parameterised form explicitly.
    const { sql, params } = sqlFor({});
    expect(sql).not.toContain(PROJECT);
    expect(params).toContain(PROJECT);
  });

  it("uses the project id it was given, not a cached one", () => {
    const { params } = sqlFor({}, OTHER_PROJECT);
    expect(params).toContain(OTHER_PROJECT);
    expect(params).not.toContain(PROJECT);
  });
});

describe("buildChunkQuery — the rest of the query", () => {
  it("joins chunks to documents", () => {
    const { sql } = sqlFor({});
    expect(sql).toContain('"chunks"');
    expect(sql).toContain('"documents"');
  });

  it("excludes archived documents by default", () => {
    const { sql, params } = sqlFor({});
    expect(sql).toContain('"documents"."status"');
    expect(params).toContain("archived");
  });

  it("applies a type filter when asked", () => {
    const { params } = sqlFor({ types: ["ticket"] });
    expect(params).toContain("ticket");
  });

  it("ignores an empty type list rather than filtering to nothing", () => {
    const { sql } = sqlFor({ types: [] });
    expect(sql).not.toContain('"chunks"."type" in');
  });

  it("treats the dateRange upper bound as end of day", () => {
    const { params } = sqlFor({ dateRange: { to: "2026-06-30" } });
    const end = params.find((p) => p instanceof Date || String(p).includes("2026-06-30"));
    expect(String(end)).toMatch(/23:59:59/);
  });

  it("applies the similarity threshold", () => {
    const { params } = sqlFor({});
    expect(params).toContain(0.3);
  });

  it("limits the result set", () => {
    const { params } = sqlFor({});
    expect(params).toContain(8);
  });
});

// A second retriever is a second chance to leak across clients, so it gets
// the same treatment as the first.
describe("buildLexicalQuery — the project filter is not optional here either", () => {
  for (const { name, input } of INPUTS) {
    it(`filters by project_id with ${name}`, () => {
      const { sql, params } = lexicalSqlFor(input);
      expect(sql).toContain('"chunks"."project_id" =');
      expect(params).toContain(PROJECT);
    });
  }

  it("never mentions another project's id", () => {
    for (const { input } of INPUTS) {
      expect(lexicalSqlFor(input).params).not.toContain(OTHER_PROJECT);
    }
  });

  it("uses the project id it was given", () => {
    const { params } = lexicalSqlFor({}, OTHER_PROJECT);
    expect(params).toContain(OTHER_PROJECT);
    expect(params).not.toContain(PROJECT);
  });

  it("searches the indexed tsvector column rather than scanning text", () => {
    // Matching on `text` directly would work and would also table-scan every
    // chunk in the project.
    expect(lexicalSqlFor({}).sql).toContain("text_search");
  });

  it("excludes archived documents, like the vector query", () => {
    const { sql, params } = lexicalSqlFor({});
    expect(sql).toContain('"documents"."status"');
    expect(params).toContain("archived");
  });

  it("binds the query text as a parameter", () => {
    const { sql, params } = lexicalSqlFor({});
    expect(params).toContain("ACME-1042 rate limiting");
    expect(sql).not.toContain("ACME-1042 rate limiting");
  });
});

describe("reciprocalRankFusion", () => {
  const id = (x: { id: string }) => x.id;

  it("keeps a single list in its original order", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(searchMod.reciprocalRankFusion([list], id).map((f) => f.item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("deduplicates across lists", () => {
    const out = searchMod.reciprocalRankFusion(
      [
        [{ id: "a" }, { id: "b" }],
        [{ id: "b" }, { id: "c" }],
      ],
      id,
    );
    expect(out.map((f) => f.item.id).sort()).toEqual(["a", "b", "c"]);
  });

  // The whole point: agreement between two retrievers beats a single
  // retriever's enthusiasm.
  it("promotes an item both lists found over one only a single list found", () => {
    const out = searchMod.reciprocalRankFusion(
      [
        [{ id: "only-vector" }, { id: "shared" }],
        [{ id: "only-lexical" }, { id: "shared" }],
      ],
      id,
    );
    expect(out[0]?.item.id).toBe("shared");
  });

  it("ranks by position, not by any score the items carry", () => {
    // Cosine similarity and ts_rank live on different scales. Fusing on
    // score is the classic mistake; these items carry deliberately
    // misleading ones.
    const out = searchMod.reciprocalRankFusion(
      [[{ id: "first", score: 0.01 }], [{ id: "second", score: 0.99 }]],
      (x) => x.id,
    );
    expect(out[0]?.item.id).toBe("first");
  });

  it("handles an empty list on either side", () => {
    expect(searchMod.reciprocalRankFusion([[], [{ id: "a" }]], id).map((f) => f.item.id)).toEqual([
      "a",
    ]);
    expect(searchMod.reciprocalRankFusion([[], []], id)).toEqual([]);
  });
});
