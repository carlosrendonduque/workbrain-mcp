import { beforeAll, describe, expect, it } from "vitest";

/**
 * The budget decides what an agent gets to see. Getting it wrong is not a
 * performance problem — it changes what the agent knows and never says so.
 */

type Mod = typeof import("./compose");
let mod: Mod;

beforeAll(async () => {
  process.env.DATABASE_URL = "postgresql://u:p@central.example.neon.tech/main?sslmode=require";
  mod = await import("./compose");
});

// approxTokens is chars/4, so 4000 characters is ~1000 tokens.
const text = (tokens: number) => "x".repeat(tokens * 4);

function focusDoc(tokens: number) {
  return {
    documentId: "doc-focus",
    path: "acme/x/tickets/ACME-1.md",
    title: "ACME-1",
    type: "ticket",
    externalId: "ACME-1",
    content: text(tokens),
    frontmatter: {},
  };
}

function linkedDoc(id: string, tokens: number) {
  return {
    documentId: id,
    contentIncluded: true,
    type: "confluence",
    externalId: id,
    title: id,
    path: `p/${id}.md`,
    content: text(tokens),
    linkType: "references",
    note: null,
  };
}

function ragChunk(id: string, tokens: number) {
  return {
    chunkId: id,
    documentId: `d-${id}`,
    documentPath: `p/${id}.md`,
    documentTitle: id,
    externalId: null,
    type: "ticket",
    text: text(tokens),
    similarity: 0.5,
  };
}

function budgetOf(over: Partial<Parameters<Mod["applyBudget"]>[0]> = {}) {
  return mod.applyBudget({
    limitTokens: 10_000,
    canonTokens: 1_000,
    instructionsTokens: 500,
    focus: focusDoc(1_000),
    linked: [],
    ragChunks: [],
    ...over,
  });
}

describe("applyBudget — when everything fits", () => {
  it("changes nothing", () => {
    const out = budgetOf({
      linked: [linkedDoc("A", 500), linkedDoc("B", 500)],
      ragChunks: [ragChunk("c1", 200)],
    });
    expect(out.budget.linkedDocsOmitted).toBe(0);
    expect(out.budget.ragChunksDropped).toBe(0);
    expect(out.budget.focusTruncated).toBe(false);
    expect(out.linked.every((d) => d.contentIncluded)).toBe(true);
  });

  it("reports what it used", () => {
    const out = budgetOf({ linked: [linkedDoc("A", 500)] });
    expect(out.budget.usedTokens).toBeGreaterThan(0);
    expect(out.budget.usedTokens).toBeLessThanOrEqual(out.budget.limitTokens);
    expect(out.budget.limitTokens).toBe(10_000);
  });
});

describe("applyBudget — linked documents are dropped whole, not cut", () => {
  // Half a Confluence page is worse than none: the agent cannot tell which
  // half it is missing. Dropping the body while keeping the reference lets
  // it ask for the document by name.
  it("keeps the reference when the content does not fit", () => {
    const out = budgetOf({ linked: [linkedDoc("A", 100), linkedDoc("HUGE", 50_000)] });
    const huge = out.linked.find((d) => d.documentId === "HUGE");
    expect(huge?.contentIncluded).toBe(false);
    expect(huge?.content).toBe("");
    expect(huge?.externalId).toBe("HUGE");
    expect(huge?.title).toBe("HUGE");
  });

  it("counts what it omitted", () => {
    const out = budgetOf({
      linked: [linkedDoc("A", 50_000), linkedDoc("B", 50_000)],
    });
    expect(out.budget.linkedDocsOmitted).toBe(2);
  });

  it("keeps the ones that fit", () => {
    const out = budgetOf({ linked: [linkedDoc("SMALL", 100), linkedDoc("HUGE", 50_000)] });
    expect(out.linked.find((d) => d.documentId === "SMALL")?.contentIncluded).toBe(true);
  });
});

describe("applyBudget — rag chunks trim from the least relevant end", () => {
  it("keeps the earlier, better-ranked chunks", () => {
    const out = budgetOf({
      limitTokens: 3_000,
      canonTokens: 500,
      instructionsTokens: 100,
      focus: focusDoc(100),
      ragChunks: [ragChunk("best", 1_000), ragChunk("worst", 50_000)],
    });
    expect(out.ragChunks.map((c) => c.chunkId)).toEqual(["best"]);
    expect(out.budget.ragChunksDropped).toBe(1);
  });
});

describe("applyBudget — the canon is never trimmed", () => {
  // A half-read convention is worse than none: the agent follows the half it
  // got and believes it followed all of it.
  it("flags the bundle as over budget instead of cutting the rules", () => {
    const out = budgetOf({ limitTokens: 2_000, canonTokens: 5_000, focus: focusDoc(100) });
    expect(out.budget.overBudget).toBe(true);
  });

  it("leaves nothing else in when the canon has eaten the budget", () => {
    const out = budgetOf({
      limitTokens: 2_000,
      canonTokens: 5_000,
      linked: [linkedDoc("A", 100)],
      ragChunks: [ragChunk("c", 100)],
    });
    expect(out.linked[0]?.contentIncluded).toBe(false);
    expect(out.ragChunks).toEqual([]);
  });
});

describe("applyBudget — the focus document", () => {
  it("survives whole when it fits", () => {
    const out = budgetOf({ focus: focusDoc(1_000) });
    expect(out.budget.focusTruncated).toBe(false);
    expect(out.focus?.content).not.toContain("truncated");
  });

  it("is truncated only as a last resort, and says so in the text", () => {
    const out = budgetOf({ limitTokens: 3_000, focus: focusDoc(50_000) });
    expect(out.budget.focusTruncated).toBe(true);
    expect(out.focus?.content).toContain("truncated");
  });

  it("handles there being no focus at all", () => {
    const out = budgetOf({ focus: null });
    expect(out.focus).toBeNull();
    expect(out.budget.focusTruncated).toBe(false);
  });
});

describe("withBudgetNotice", () => {
  const clean = {
    limitTokens: 10_000,
    usedTokens: 500,
    linkedDocsOmitted: 0,
    ragChunksDropped: 0,
    focusTruncated: false,
    overBudget: false,
  };

  it("adds nothing when the bundle is complete", () => {
    expect(mod.withBudgetNotice("BASE", clean)).toBe("BASE");
  });

  // The metadata carries the same numbers, but an agent is not obliged to
  // read metadata and will not reason about what it did not notice.
  it("tells the agent when linked documents were left out", () => {
    const out = mod.withBudgetNotice("BASE", { ...clean, linkedDocsOmitted: 3 });
    expect(out).toContain("incomplete");
    expect(out).toContain("3 linked document");
  });

  it("tells the agent when the focus was truncated", () => {
    expect(mod.withBudgetNotice("BASE", { ...clean, focusTruncated: true })).toContain("TRUNCATED");
  });

  it("tells the agent when chunks were dropped", () => {
    expect(mod.withBudgetNotice("BASE", { ...clean, ragChunksDropped: 5 })).toContain("5 lower");
  });

  it("says the canon was kept whole when it blew the budget", () => {
    const out = mod.withBudgetNotice("BASE", { ...clean, overBudget: true });
    expect(out).toMatch(/NOT trimmed/);
    expect(out).toMatch(/shortening/);
  });

  it("keeps the original instructions", () => {
    expect(mod.withBudgetNotice("BASE", { ...clean, ragChunksDropped: 1 })).toContain("BASE");
  });
});
