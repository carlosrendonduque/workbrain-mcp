// Chunk markdown by meaning, not by window.
//
// Rules (Section 8 of the Phase 1 design doc):
//   1. Split the body into blocks by paragraph (double newlines), keeping
//      fenced code blocks intact across paragraph boundaries.
//   2. Headings (# … ######) are always emitted as their own chunk regardless
//      of length.
//   3. Paragraphs shorter than MIN_CHUNK_CHARS are discarded — except headings.
//   4. Paragraphs longer than MAX_PARAGRAPH_TOKENS are split first by single
//      newlines, then (as fallback) by sentence boundary. Never split inside
//      a code block.
//   5. Code blocks are emitted as a single chunk unless they exceed
//      MAX_CODE_BLOCK_TOKENS, in which case they are split by line groups
//      while preserving the opening and closing fences on each piece.

const MIN_CHUNK_CHARS = 20;
const MAX_PARAGRAPH_TOKENS = 1000;
const MAX_CODE_BLOCK_TOKENS = 2000;
const CHARS_PER_TOKEN = 4;

const HEADING_PATTERN = /^#{1,6}\s/;
const FENCE_PATTERN = /^\s*```/;
const SENTENCE_SPLIT_PATTERN = /(?<=[.!?])\s+/;

export interface Chunk {
  index: number;
  text: string;
  tokenCount: number;
}

export function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function isHeading(text: string): boolean {
  return HEADING_PATTERN.test(text.trimStart());
}

function isCodeBlock(text: string): boolean {
  return FENCE_PATTERN.test(text);
}

// Walk the source line by line, group into blocks separated by blank lines,
// but treat anything between matching ``` fences as a single block.
function splitIntoBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const lines = markdown.split("\n");

  let paragraph: string[] = [];
  let codeBlock: string[] = [];
  let inCode = false;

  const flushParagraph = (): void => {
    const joined = paragraph.join("\n").trim();
    if (joined.length > 0) blocks.push(joined);
    paragraph = [];
  };

  for (const line of lines) {
    if (inCode) {
      codeBlock.push(line);
      if (FENCE_PATTERN.test(line)) {
        blocks.push(codeBlock.join("\n"));
        codeBlock = [];
        inCode = false;
      }
      continue;
    }

    if (FENCE_PATTERN.test(line)) {
      flushParagraph();
      codeBlock = [line];
      inCode = true;
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    paragraph.push(line);
  }

  // Flush whatever is left over. Unterminated code blocks become a single
  // block so we don't silently drop content.
  if (codeBlock.length > 0) blocks.push(codeBlock.join("\n"));
  flushParagraph();

  return blocks;
}

function splitLargeParagraph(text: string): string[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // First try grouping by single newlines while staying under the budget.
  if (lines.length > 1) {
    return packIntoBudget(lines, "\n", MAX_PARAGRAPH_TOKENS);
  }

  // Fallback to sentence boundaries.
  const sentences = text.split(SENTENCE_SPLIT_PATTERN);
  if (sentences.length > 1) {
    return packIntoBudget(sentences, " ", MAX_PARAGRAPH_TOKENS);
  }

  // No way to split further — emit as-is so we don't drop content.
  return [text];
}

function packIntoBudget(parts: string[], joiner: string, budget: number): string[] {
  const out: string[] = [];
  let acc = "";
  for (const part of parts) {
    const candidate = acc.length === 0 ? part : `${acc}${joiner}${part}`;
    if (approxTokens(candidate) > budget && acc.length > 0) {
      out.push(acc);
      acc = part;
    } else {
      acc = candidate;
    }
  }
  if (acc.length > 0) out.push(acc);
  return out;
}

function splitLargeCodeBlock(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length < 3) return [text];

  const fenceOpen = lines[0] ?? "```";
  const fenceClose = lines[lines.length - 1] ?? "```";
  const body = lines.slice(1, -1);

  const fenceOverhead = approxTokens(`${fenceOpen}\n\n${fenceClose}`);
  const bodyBudget = MAX_CODE_BLOCK_TOKENS - fenceOverhead;

  const groups = packIntoBudget(body, "\n", bodyBudget);
  return groups.map((group) => `${fenceOpen}\n${group}\n${fenceClose}`);
}

export function chunkMarkdown(markdown: string): Chunk[] {
  const blocks = splitIntoBlocks(markdown);
  const texts: string[] = [];

  for (const block of blocks) {
    if (isCodeBlock(block)) {
      if (approxTokens(block) <= MAX_CODE_BLOCK_TOKENS) {
        texts.push(block);
      } else {
        texts.push(...splitLargeCodeBlock(block));
      }
      continue;
    }

    if (isHeading(block)) {
      // Headings are always preserved, regardless of length.
      texts.push(block.trim());
      continue;
    }

    if (block.length < MIN_CHUNK_CHARS) {
      // Discard short non-heading paragraphs.
      continue;
    }

    if (approxTokens(block) <= MAX_PARAGRAPH_TOKENS) {
      texts.push(block);
    } else {
      texts.push(...splitLargeParagraph(block));
    }
  }

  return texts.map((text, index) => ({
    index,
    text,
    tokenCount: approxTokens(text),
  }));
}
