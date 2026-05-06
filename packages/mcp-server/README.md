# @workbrain/mcp-server

Local MCP server that exposes WorkBrain to Cursor and Claude Code over stdio.

Four tools are wired:

| Tool | Backend route | Purpose |
|------|---------------|---------|
| `ingest_paste` | `POST /api/ingest/paste` | Ingest a pasted document into the active project's corpus. |
| `search` | `POST /api/search` | Semantic search filtered by the active project. |
| `set_active_project` | `GET /api/projects` then state | Switch the active project (validated against your project list). |
| `current_project` | `GET /api/projects` | Report the active project. |

The active project is held in memory for the lifetime of the MCP process. Cursor and Claude Code restart the binary frequently, so don't rely on it surviving across sessions.

## Build

From the repo root:

```bash
pnpm install
pnpm --filter @workbrain/mcp-server build
```

The compiled entrypoint lands at `packages/mcp-server/dist/index.js`.

## Backend prerequisites

The MCP server is a thin client; it needs the WorkBrain backend reachable on `WORKBRAIN_API_URL`.

```bash
# Apply migrations + seed the dev project list (idempotent).
pnpm --filter @workbrain/web db:migrate
pnpm --filter @workbrain/web db:seed:dev

# Generate an API key (printed once to stdout).
pnpm --filter @workbrain/web exec tsx scripts/generate-api-key.ts <email> <label>

# Start the backend on http://localhost:3000.
pnpm --filter @workbrain/web dev
```

## Configure Claude Code (VS Code extension)

Workspace-level config lives in `.mcp.json` at the repo root. A template is committed at `.mcp.json.example`; the real file is gitignored because it carries an API key.

Copy and fill in:

```bash
cp .mcp.json.example .mcp.json
```

Edit `.mcp.json` so it looks like this — use **absolute paths** because Cursor / VS Code do not load your shell rc files:

```json
{
  "mcpServers": {
    "workbrain": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/workbrain/packages/mcp-server/dist/index.js"],
      "env": {
        "WORKBRAIN_API_URL": "http://localhost:3000",
        "WORKBRAIN_API_KEY": "wbk_<your key>"
      }
    }
  }
}
```

Find the absolute paths with:

```bash
readlink -f $(which node)
readlink -f packages/mcp-server/dist/index.js
```

After editing, **reload the VS Code window** (Command Palette → "Developer: Reload Window"). Claude Code reads `.mcp.json` on workspace open and prompts you to approve the new server. Accept it.

## Configure Cursor

Cursor uses the same JSON format but a different file path:

- Workspace-level: `.cursor/mcp.json` at the repo root (templated at `.cursor/mcp.json.example`)
- Global: `~/.cursor/mcp.json`

```bash
cp .cursor/mcp.json.example .cursor/mcp.json
# edit .cursor/mcp.json with the same absolute paths and API key
```

After editing, fully restart Cursor (Cmd/Ctrl+Q then reopen). The `workbrain` server should appear in the MCP panel and the four tools become available to the agent.

## Verify the integration

With the backend running, a working integration looks like this:

1. In the IDE chat, ask the agent: *"call set_active_project with project-x"*. It should report something like `{ projectSlug: "project-x", projectName: "Project X (placeholder)" }`.
2. Ask: *"ingest this as a ticket"* and paste any text. The agent should call `ingest_paste` and return a `documentId` plus `chunkCount`.
3. Ask: *"search for <something from your paste>"*. The agent should call `search` and return matching chunks scoped to project-x only.

For a non-IDE smoke test that exercises the same path:

```bash
WORKBRAIN_API_URL="http://localhost:3000" \
WORKBRAIN_API_KEY="wbk_<your key>" \
  pnpm --filter @workbrain/mcp-server smoke
```

Expected output:

```
✅ initialize
✅ tools/list returned 4 tool(s):
     - ingest_paste
     - search
     - set_active_project
     - current_project
✅ set_active_project -> project-x (Project X (placeholder))
✅ current_project -> project-x
✅ search returned N chunk(s)
```

## Troubleshooting

- **Tools don't appear in Cursor / Claude Code.** Reload the window (or fully restart Cursor). Confirm the MCP server JSON file is at the right path. Run `pnpm --filter @workbrain/mcp-server smoke` first to rule out the server itself.
- **`ENOENT: node`** when the IDE launches the server. Use the absolute path to node (output of `readlink -f $(which node)`), not bare `"command": "node"`. The IDE doesn't load your shell rc.
- **`WORKBRAIN_API_URL is not set`** in stderr. The IDE didn't pass the env. Make sure the `env` block in the JSON has both vars.
- **`HTTP 401`** in tool errors. The API key is wrong, expired, or doesn't exist in `api_keys`. Generate a new one with the script above.
- **`HTTP 404 project_not_found`**. Run `pnpm --filter @workbrain/web db:seed:dev` to create the placeholder projects, or seed your real projects with `seed-projects.ts` (Task 1.14, when available).
- **Tool call hangs forever.** The backend isn't running on `WORKBRAIN_API_URL`, or the URL points to the wrong port. Confirm with `curl -i http://localhost:3000/api/health -H "Authorization: Bearer wbk_..."`.

## Development

```bash
pnpm --filter @workbrain/mcp-server typecheck   # tsc --noEmit
pnpm --filter @workbrain/mcp-server build       # compile to dist/
pnpm --filter @workbrain/mcp-server smoke       # run the smoke test (needs backend)
```

After editing source, **rebuild before reloading the IDE**, or the IDE will keep running the old `dist/index.js`.
