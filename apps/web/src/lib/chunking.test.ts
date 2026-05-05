import { describe, expect, it } from "vitest";
import { approxTokens, chunkMarkdown } from "./chunking";

describe("chunkMarkdown — paragraph splitting", () => {
  it("splits a document into one chunk per paragraph", () => {
    const md =
      "First paragraph that is long enough to survive.\n\n" +
      "Second paragraph, also clearly past the threshold.\n\n" +
      "Third paragraph with a bit more text inside.";
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.text).toContain("First paragraph");
    expect(chunks[1]?.text).toContain("Second paragraph");
    expect(chunks[2]?.text).toContain("Third paragraph");
  });

  it("assigns sequential index numbers", () => {
    const md = "A long enough paragraph here.\n\nAnother paragraph that survives.";
    const chunks = chunkMarkdown(md);
    expect(chunks.map((c) => c.index)).toEqual([0, 1]);
  });

  it("returns no chunks for empty input", () => {
    expect(chunkMarkdown("")).toEqual([]);
    expect(chunkMarkdown("\n\n\n")).toEqual([]);
  });
});

describe("chunkMarkdown — heading preservation", () => {
  it("emits headings as their own chunks regardless of length", () => {
    const md = "# Tiny\n\nA long enough paragraph that survives.";
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toBe("# Tiny");
  });

  it("keeps headings even when shorter than MIN_CHUNK_CHARS", () => {
    const md = "## Hi\n\nAnother long enough paragraph here, OK?";
    const chunks = chunkMarkdown(md);
    expect(chunks[0]?.text).toBe("## Hi");
  });

  it("recognizes all six heading levels", () => {
    const md = ["# h1", "## h2", "### h3", "#### h4", "##### h5", "###### h6"].join("\n\n");
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(6);
    for (let i = 0; i < 6; i += 1) {
      expect(chunks[i]?.text.startsWith("#".repeat(i + 1))).toBe(true);
    }
  });
});

describe("chunkMarkdown — short paragraph rejection", () => {
  it("discards non-heading paragraphs shorter than 20 chars", () => {
    const md = "tiny.\n\nA long enough paragraph that survives the filter.";
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain("survives the filter");
  });

  it("keeps paragraphs that are exactly at the threshold", () => {
    const text = "a".repeat(20);
    const md = `${text}\n\n# heading`;
    const chunks = chunkMarkdown(md);
    expect(chunks.some((c) => c.text === text)).toBe(true);
  });
});

describe("chunkMarkdown — code block preservation", () => {
  it("keeps a fenced code block as a single chunk", () => {
    const code = "```ts\nconst x = 1;\nconst y = 2;\n```";
    const md = `Some prose here that is long enough.\n\n${code}\n\nMore prose for context.`;
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(3);
    expect(chunks[1]?.text).toBe(code);
  });

  it("does not break a code block on internal blank lines", () => {
    const code = "```\nline one\n\nline two after blank\n```";
    const chunks = chunkMarkdown(code);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe(code);
  });

  it("splits an oversize code block by line groups, preserving fences", () => {
    const longBody = Array.from(
      { length: 1500 },
      (_, i) => `line ${i.toString().padStart(8, "0")};`,
    ).join("\n");
    const code = `\`\`\`ts\n${longBody}\n\`\`\``;
    expect(approxTokens(code)).toBeGreaterThan(2000);

    const chunks = chunkMarkdown(code);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("```ts")).toBe(true);
      expect(chunk.text.endsWith("```")).toBe(true);
      expect(chunk.tokenCount).toBeLessThanOrEqual(2000);
    }
  });
});

describe("chunkMarkdown — large paragraph splitting", () => {
  it("splits a single oversize paragraph into multiple chunks", () => {
    const line = "This is a single representative line of body content.";
    const oversize = Array.from({ length: 200 }, () => line).join("\n");
    expect(approxTokens(oversize)).toBeGreaterThan(1000);

    const chunks = chunkMarkdown(oversize);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(1000);
    }
  });

  it("falls back to sentence boundaries when the paragraph has no newlines", () => {
    const sentence = "Lorem ipsum dolor sit amet consectetur adipiscing elit. ";
    const oversize = sentence.repeat(120).trim();
    expect(approxTokens(oversize)).toBeGreaterThan(1000);

    const chunks = chunkMarkdown(oversize);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("chunkMarkdown — token count", () => {
  it("approximates tokens as ceil(chars/4)", () => {
    expect(approxTokens("")).toBe(0);
    expect(approxTokens("abcd")).toBe(1);
    expect(approxTokens("abcde")).toBe(2);
  });
});
