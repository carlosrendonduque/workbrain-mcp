// Active project for the MCP session.
//
// The in-memory value is the source of truth for the lifetime of the process,
// but it is also persisted per working directory so a brand-new chat in a repo
// the user has already bound resolves the project without asking. Without this,
// every new host process starts with no active project and compose_context /
// get_canon fail on the first call of every conversation.
//
// Resolution order: in-memory > WORKBRAIN_PROJECT_SLUG > persisted binding for
// the current working directory (longest matching prefix, so subdirectories of
// a bound repo inherit it).
//
// There is deliberately NO global "last project used" fallback. Clients are
// siloed by design, and silently resolving to whatever project was touched last
// would surface one client's context inside another client's repo.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

interface PersistedState {
  // Absolute directory -> project slug bound to it.
  byPath: Record<string, string>;
}

const EMPTY_STATE: PersistedState = { byPath: {} };

let activeProjectSlug: string | null = null;

function stateFilePath(): string {
  return process.env.WORKBRAIN_STATE_FILE ?? join(homedir(), ".workbrain", "state.json");
}

// Persistence is a convenience, never a hard dependency: a missing, unreadable
// or corrupt state file degrades to "no binding", it does not fail the server.
function readState(): PersistedState {
  try {
    const raw = readFileSync(stateFilePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_STATE;
    const byPath = (parsed as Record<string, unknown>).byPath;
    if (!byPath || typeof byPath !== "object") return EMPTY_STATE;
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(byPath as Record<string, unknown>)) {
      if (typeof value === "string" && value.length > 0) clean[key] = value;
    }
    return { byPath: clean };
  } catch {
    return EMPTY_STATE;
  }
}

function writeState(state: PersistedState): void {
  try {
    const file = stateFilePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`workbrain: could not persist active project: ${message}`);
  }
}

// Longest bound ancestor of `dir` wins, so a repo bound at its root still
// resolves from any subdirectory, and a nested repo with its own binding beats
// the outer one.
function resolveBinding(dir: string, byPath: Record<string, string>): string | null {
  const target = resolve(dir);
  let bestLength = -1;
  let bestSlug: string | null = null;
  for (const [bound, slug] of Object.entries(byPath)) {
    const candidate = resolve(bound);
    const matches = target === candidate || target.startsWith(candidate + sep);
    if (!matches) continue;
    if (candidate.length > bestLength) {
      bestLength = candidate.length;
      bestSlug = slug;
    }
  }
  return bestSlug;
}

export function getActiveProject(): string | null {
  if (activeProjectSlug) return activeProjectSlug;

  const fromEnv = process.env.WORKBRAIN_PROJECT_SLUG;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  return resolveBinding(process.cwd(), readState().byPath);
}

export function setActiveProject(slug: string | null): void {
  activeProjectSlug = slug;

  const state = readState();
  const cwd = resolve(process.cwd());
  if (slug) {
    if (state.byPath[cwd] === slug) return;
    state.byPath[cwd] = slug;
  } else {
    if (!(cwd in state.byPath)) return;
    delete state.byPath[cwd];
  }
  writeState(state);
}

// How the current value was arrived at — reported by current_project so the
// agent (and the user) can tell an explicit choice from an inherited binding.
export type ActiveProjectSource = "session" | "env" | "directory" | "none";

export function getActiveProjectSource(): ActiveProjectSource {
  if (activeProjectSlug) return "session";
  const fromEnv = process.env.WORKBRAIN_PROJECT_SLUG;
  if (fromEnv && fromEnv.length > 0) return "env";
  if (resolveBinding(process.cwd(), readState().byPath)) return "directory";
  return "none";
}
