import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each test imports the module fresh so the in-memory slot starts empty —
// that is what a new host process (a new chat) actually looks like.
async function freshState() {
  vi.resetModules();
  return import("./state.js");
}

let root: string;
let stateFile: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  // realpath: on macOS tmpdir() is a symlink, and process.cwd() reports the
  // resolved path — an unresolved prefix would never match.
  root = realpathSync(mkdtempSync(join(tmpdir(), "workbrain-state-")));
  stateFile = join(root, "state.json");
  process.env.WORKBRAIN_STATE_FILE = stateFile;
  delete process.env.WORKBRAIN_PROJECT_SLUG;
});

afterEach(() => {
  process.chdir(originalCwd);
  delete process.env.WORKBRAIN_STATE_FILE;
  delete process.env.WORKBRAIN_PROJECT_SLUG;
  rmSync(root, { recursive: true, force: true });
});

function makeDir(...segments: string[]): string {
  const dir = join(root, ...segments);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("getActiveProject", () => {
  it("reports no project when nothing has been bound", async () => {
    process.chdir(makeDir("repo"));
    const state = await freshState();
    expect(state.getActiveProject()).toBeNull();
    expect(state.getActiveProjectSource()).toBe("none");
  });

  it("survives a process restart in the same directory", async () => {
    const repo = makeDir("repo");
    process.chdir(repo);

    const first = await freshState();
    first.setActiveProject("acme");
    expect(first.getActiveProjectSource()).toBe("session");

    const second = await freshState();
    expect(second.getActiveProject()).toBe("acme");
    expect(second.getActiveProjectSource()).toBe("directory");
  });

  it("inherits the binding in subdirectories of the bound repo", async () => {
    const repo = makeDir("repo");
    process.chdir(repo);
    (await freshState()).setActiveProject("acme");

    process.chdir(makeDir("repo", "force-app", "main"));
    expect((await freshState()).getActiveProject()).toBe("acme");
  });

  it("prefers the innermost binding when repos are nested", async () => {
    const outer = makeDir("outer");
    process.chdir(outer);
    (await freshState()).setActiveProject("acme");

    const inner = makeDir("outer", "inner");
    process.chdir(inner);
    (await freshState()).setActiveProject("orion");

    expect((await freshState()).getActiveProject()).toBe("orion");

    process.chdir(outer);
    expect((await freshState()).getActiveProject()).toBe("acme");
  });

  it("does not leak a binding into an unrelated directory", async () => {
    process.chdir(makeDir("client-a-repo"));
    (await freshState()).setActiveProject("acme");

    process.chdir(makeDir("client-b-repo"));
    expect((await freshState()).getActiveProject()).toBeNull();
  });

  it("lets the environment override a directory binding", async () => {
    const repo = makeDir("repo");
    process.chdir(repo);
    (await freshState()).setActiveProject("acme");

    process.env.WORKBRAIN_PROJECT_SLUG = "orion";
    const state = await freshState();
    expect(state.getActiveProject()).toBe("orion");
    expect(state.getActiveProjectSource()).toBe("env");
  });

  it("lets an explicit call override the environment", async () => {
    process.chdir(makeDir("repo"));
    process.env.WORKBRAIN_PROJECT_SLUG = "orion";

    const state = await freshState();
    state.setActiveProject("acme");
    expect(state.getActiveProject()).toBe("acme");
    expect(state.getActiveProjectSource()).toBe("session");
  });

  it("degrades to no binding when the state file is corrupt", async () => {
    process.chdir(makeDir("repo"));
    writeFileSync(stateFile, "{ not json", "utf8");

    const state = await freshState();
    expect(state.getActiveProject()).toBeNull();
  });
});

describe("setActiveProject", () => {
  it("clears the binding for the current directory when passed null", async () => {
    const repo = makeDir("repo");
    process.chdir(repo);

    (await freshState()).setActiveProject("acme");
    (await freshState()).setActiveProject(null);

    expect((await freshState()).getActiveProject()).toBeNull();
  });
});
