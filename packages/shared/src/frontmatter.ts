import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const DELIMITER_PATTERN = /^---\s*\r?\n([\s\S]*?)\r?\n?---\s*\r?\n?/;

export interface ParsedDocument {
  frontmatter: Record<string, unknown>;
  content: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parse(markdown: string): ParsedDocument {
  const match = DELIMITER_PATTERN.exec(markdown);
  if (!match) {
    return { frontmatter: {}, content: markdown };
  }

  const yamlBlock = match[1] ?? "";
  const parsed: unknown = yamlBlock.trim().length === 0 ? {} : parseYaml(yamlBlock);
  const frontmatter = isRecord(parsed) ? parsed : {};
  const content = markdown.slice(match[0].length);

  return { frontmatter, content };
}

export function serialize(content: string, frontmatter: Record<string, unknown>): string {
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd();
  const trimmedContent = content.replace(/^\s+/, "");
  return `---\n${yaml}\n---\n\n${trimmedContent}`;
}
