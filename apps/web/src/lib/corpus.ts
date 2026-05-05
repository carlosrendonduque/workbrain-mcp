import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { frontmatter as fm } from "@workbrain/shared";

export interface CorpusConfig {
  rootPath: string;
}

export interface WriteResult {
  absolutePath: string;
  relativePath: string;
}

export interface ReadResult {
  frontmatter: Record<string, unknown>;
  content: string;
  absolutePath: string;
  relativePath: string;
}

function loadConfigFromEnv(): CorpusConfig {
  const rootPath = process.env.WORKBRAIN_CORPUS_PATH;
  if (!rootPath) throw new Error("WORKBRAIN_CORPUS_PATH is not set");
  return { rootPath };
}

function resolveInsideRoot(rootPath: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new Error(`relativePath must be relative to corpus root: ${relativePath}`);
  }
  const absoluteRoot = resolve(rootPath);
  const candidate = resolve(absoluteRoot, normalize(relativePath));
  const within = relative(absoluteRoot, candidate);
  if (within.startsWith("..") || isAbsolute(within)) {
    throw new Error(`path escapes corpus root: ${relativePath}`);
  }
  return candidate;
}

export async function writeDocument(
  relativePath: string,
  frontmatterObj: Record<string, unknown>,
  content: string,
  config: CorpusConfig = loadConfigFromEnv(),
): Promise<WriteResult> {
  const absolutePath = resolveInsideRoot(config.rootPath, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  const md = fm.serialize(content, frontmatterObj);
  await writeFile(absolutePath, md, "utf8");
  return { absolutePath, relativePath };
}

export async function readDocument(
  relativePath: string,
  config: CorpusConfig = loadConfigFromEnv(),
): Promise<ReadResult> {
  const absolutePath = resolveInsideRoot(config.rootPath, relativePath);
  const md = await readFile(absolutePath, "utf8");
  const parsed = fm.parse(md);
  return { ...parsed, absolutePath, relativePath };
}

export function buildDocumentPath(parts: {
  clientSlug: string;
  projectSlug: string;
  typeFolder: string;
  fileName: string;
}): string {
  return join(parts.clientSlug, parts.projectSlug, parts.typeFolder, parts.fileName);
}
