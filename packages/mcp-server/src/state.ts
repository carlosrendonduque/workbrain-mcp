// In-memory active project for the lifetime of the MCP process. Cleared every
// time the host (Cursor / Claude Code) restarts the server.

let activeProjectSlug: string | null = null;

export function getActiveProject(): string | null {
  return activeProjectSlug;
}

export function setActiveProject(slug: string | null): void {
  activeProjectSlug = slug;
}
