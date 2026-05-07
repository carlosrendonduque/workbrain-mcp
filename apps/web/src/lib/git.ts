import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export interface GitOptions {
  cwd: string;
  logger?: (msg: string) => void;
}

export interface RepoConfig {
  rootPath: string;
  remoteUrl: string;
  branch: string;
}

function defaultLogger(msg: string): void {
  console.log(msg);
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function git(args: string[], opts: GitOptions): Promise<{ stdout: string; stderr: string }> {
  return execFile("git", args, { cwd: opts.cwd });
}

export async function ensureRepo(config: RepoConfig, logger = defaultLogger): Promise<void> {
  await mkdir(config.rootPath, { recursive: true });

  const gitDir = join(config.rootPath, ".git");
  if (!existsSync(gitDir)) {
    await git(["init", "-b", config.branch], { cwd: config.rootPath });
    logger(`git: initialized repo at ${config.rootPath} on ${config.branch}`);
  }

  try {
    await git(["remote", "set-url", "origin", config.remoteUrl], { cwd: config.rootPath });
  } catch {
    await git(["remote", "add", "origin", config.remoteUrl], { cwd: config.rootPath });
    logger(`git: added remote origin -> ${config.remoteUrl}`);
  }
}

export async function commitAndPush(
  relativePath: string,
  message: string,
  config: RepoConfig,
  logger = defaultLogger,
): Promise<void> {
  try {
    await git(["add", relativePath], { cwd: config.rootPath });

    try {
      await git(["commit", "-m", message], { cwd: config.rootPath });
    } catch (err) {
      // No-op when there is nothing to commit (file is identical to HEAD).
      const text = describeError(err);
      if (/nothing to commit|no changes added/i.test(text)) {
        logger(`git: ${relativePath} unchanged, skipping commit`);
        return;
      }
      throw err;
    }

    await git(["push", "-u", "origin", config.branch], { cwd: config.rootPath });
    logger(`git: pushed ${relativePath} to ${config.branch}`);
  } catch (err) {
    logger(`git: commitAndPush failed for ${relativePath}: ${describeError(err)}`);
  }
}

export async function loadRepoConfigFromEnv(): Promise<RepoConfig | null> {
  const rootPath = process.env.WORKBRAIN_CORPUS_PATH;
  const remoteUrl = process.env.WORKBRAIN_CORPUS_REMOTE;
  const branch = process.env.WORKBRAIN_CORPUS_BRANCH ?? "main";
  // Corpus disk-mirror is optional. In serverless deploys (Vercel) the
  // filesystem is ephemeral, so we skip the mirror entirely when these env
  // vars are missing. The DB remains the source of truth.
  if (!rootPath || !remoteUrl) return null;
  return { rootPath, remoteUrl, branch };
}
