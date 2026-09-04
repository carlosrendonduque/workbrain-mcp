# WorkBrain

Multi-client project memory layer for Cursor and Claude Code, consumed via MCP.

> **Phase 1** — paste ingestion + semantic search, end-to-end, for two pilot projects.
> See [`docs/04-workbrain-design-final.md`](docs/04-workbrain-design-final.md) for the executable Phase 1 spec, and [`docs/02-workbrain-implementation-brief.md`](docs/02-workbrain-implementation-brief.md) for the multi-phase roadmap.

## Stack

- **Runtime:** Node 22 LTS, pnpm 10
- **Backend:** Next.js 15 (App Router) on Vercel
- **Database:** Postgres on Neon (Launch plan), pgvector with HNSW
- **ORM:** Drizzle
- **Embeddings:** Voyage 3 Large (1024 dims)
- **MCP:** Local stdio server in `packages/mcp-server` exposing 4 tools
- **Lint + format:** Biome
- **Tests:** Vitest

## Layout

```
workbrain/
├── apps/web/                  # Next.js backend (API routes for Phase 1, webapp for Phase 4)
│   ├── scripts/               # migrate, seed-dev, seed-projects, generate-api-key, voyage-test, corpus-init/demo, db-info
│   ├── src/
│   │   ├── app/api/           # /api/health, /api/projects, /api/ingest/paste, /api/search
│   │   ├── lib/               # db, auth, embeddings, chunking, corpus, git, paste, search
│   │   └── middleware.ts      # API key validation on /api/*
│   └── drizzle.config.ts
├── packages/
│   ├── shared/                # Drizzle schema, frontmatter helpers (yaml)
│   └── mcp-server/            # MCP stdio server, 4 tools, smoke test
├── drizzle/                   # generated migration SQL + meta
├── docs/                      # design documents
└── corpus/                    # local markdown corpus — separate git repo, gitignored here
```

## Quick start (≤30 minutes on a fresh laptop)

### Prerequisites

- **Node 22 LTS** (use `nvm use` to pick up `.nvmrc`).
- **pnpm 10+** (auto-activated via corepack: `corepack enable && corepack prepare pnpm@latest --activate`).
- **GitHub CLI authenticated** (`gh auth login`) — used to push to the corpus repo over HTTPS.
- **Neon account on the Launch plan** (~$15/mo) — gives 7-day PITR. Sign up at https://console.neon.tech.
- **Voyage AI account** for the embedding API — sign up at https://www.voyageai.com.
- **Two private GitHub repos**:
  - One for this code (e.g. `https://github.com/<you>/workbrain.git`).
  - One for the corpus, **separate** (e.g. `https://github.com/<you>/workbrain-corpus.git`). Client data lives there, never inside this code repo.

### 1. Clone and install

```bash
git clone <your code repo> workbrain && cd workbrain
nvm use                                  # activates Node 22 from .nvmrc
pnpm install
```

### 2. Configure `.env.local`

```bash
cp apps/web/.env.example apps/web/.env.local
```

Open `apps/web/.env.local` and fill in:

- `DATABASE_URL` — Neon **pooled** connection (host contains `-pooler`).
- `DATABASE_URL_UNPOOLED` — Neon **direct** connection (same host without `-pooler`). Used by `drizzle-kit migrate` and admin scripts.
- `VOYAGE_API_KEY` — your Voyage key (`pa-...`).
- `WORKBRAIN_API_KEYS_SALT` — generate one: `openssl rand -hex 32`.
- `WORKBRAIN_CORPUS_PATH` — leave at `../../corpus` (relative to `apps/web`).
- `WORKBRAIN_CORPUS_REMOTE` — your corpus repo HTTPS URL.
- `WORKBRAIN_CORPUS_BRANCH` — `main`.

### 3. Apply schema and seed dev data

```bash
pnpm --filter @workbrain/web db:migrate
pnpm --filter @workbrain/web db:seed:dev
```

This creates 9 tables, the HNSW index on `chunks.embedding`, and a placeholder client (`client-a`) with two projects (`project-x`, `project-y`).

To verify:

```bash
pnpm --filter @workbrain/web db:info
```

You should see the `vector` extension installed, 9 tables, and the `chunks_embedding_idx` HNSW index.

### 4. Generate an API key

```bash
pnpm --filter @workbrain/web exec tsx scripts/generate-api-key.ts <your email> <label>
```

The raw key (`wbk_<64 hex chars>`) is printed once. Copy it now — only the HMAC-SHA256 hash is stored.

### 5. Initialize the corpus and build the MCP server

```bash
pnpm --filter @workbrain/web corpus:init        # mkdir corpus, git init, add remote
pnpm --filter @workbrain/mcp-server build       # compile MCP to dist/
```

### 6. Wire the MCP server into your IDE

Copy the templates and fill in absolute paths plus your API key:

```bash
cp .mcp.json.example .mcp.json                  # for Claude Code (VS Code extension)
cp .cursor/mcp.json.example .cursor/mcp.json    # for Cursor
```

Both files are gitignored. Find the absolute paths with:

```bash
readlink -f $(which node)
readlink -f packages/mcp-server/dist/index.js
```

See [`packages/mcp-server/README.md`](packages/mcp-server/README.md) for full per-IDE instructions and troubleshooting.

### 7. Start the backend and verify

In one terminal:

```bash
pnpm --filter @workbrain/web dev
```

In another, sanity check:

```bash
curl -i -H "Authorization: Bearer <your wbk_ key>" http://localhost:3000/api/health
# expect 200 with the user id

pnpm --filter @workbrain/mcp-server smoke       # WORKBRAIN_API_KEY=<your key> in env
```

The smoke test should print:

```
✅ initialize
✅ tools/list returned 4 tool(s)
✅ set_active_project -> project-x
✅ search returned N chunk(s)
```

Reload Cursor / VS Code, accept the new MCP server when prompted, and you're done.

### 8. Replace placeholders with your real projects (optional)

```bash
pnpm --filter @workbrain/web db:seed:projects
```

Interactive prompt for client and project slugs. Validates uniqueness, asks before applying, and offers to archive the placeholder data when finished.

## Day-to-day commands

| Command | What it does |
|---------|--------------|
| `pnpm --filter @workbrain/web dev` | Start the backend on `http://localhost:3000` |
| `pnpm typecheck` | TypeScript across all workspaces |
| `pnpm test` | Vitest across all workspaces (33+ tests) |
| `pnpm format` | Biome write |
| `pnpm --filter @workbrain/web db:migrate` | Apply pending migrations to the central database |
| `pnpm --filter @workbrain/web db:migrate:all` | Apply them to the central database **and every dedicated client database** |
| `pnpm --filter @workbrain/web db:isolation` | Show where each client's corpus lives and whether the app can reach it |
| `pnpm --filter @workbrain/web db:isolate <client>` | Move a client into a database of its own |
| `pnpm --filter @workbrain/web check:sessions` | Find any chat session that touched more than one client |
| `pnpm --filter @workbrain/web db:generate` | Generate new migration from schema diff |
| `pnpm --filter @workbrain/web db:info` | Inspect tables, extensions, indexes |
| `pnpm --filter @workbrain/web db:seed:dev` | Idempotent dev seed (placeholders) |
| `pnpm --filter @workbrain/web db:seed:projects` | Interactive seed for real projects |
| `pnpm --filter @workbrain/web voyage:test` | Hit Voyage with one string, expect 1024-dim vector |
| `pnpm --filter @workbrain/web corpus:init` | mkdir corpus + git init + add remote |
| `pnpm --filter @workbrain/web corpus:demo` | Write + commit + push a demo ticket end-to-end |
| `pnpm --filter @workbrain/mcp-server build` | Compile the MCP server to `dist/` |
| `pnpm --filter @workbrain/mcp-server smoke` | Spawn server, list tools, run a search |

## API surface (Phase 1)

All endpoints require `Authorization: Bearer wbk_<key>`. Responses follow `{ ok: true, data } | { ok: false, error }`.

| Route | Body | Returns |
|-------|------|---------|
| `GET /api/health` | — | `{ userId, message }` (smoke) |
| `GET /api/projects` | — | `{ projectId, projectSlug, projectName, persist, clientId, clientSlug, clientName }[]` |
| `POST /api/ingest/paste` | `{ projectSlug, type, title, content, externalId?, status?, tags?, relatedTickets? }` | `{ documentId, path, frontmatter, chunkCount }` |
| `POST /api/search` | `{ query, projectSlug, types?, topK?, minSimilarity? }` | `{ chunks: SearchChunk[] }` |

Every call writes a row to `invocations` (success or error path).

## MCP tools (Phase 1)

Exposed by `packages/mcp-server` over stdio:

- `set_active_project` — switch the active project (validated against `/api/projects`) and bind it to the current working directory.
- `current_project` — report the active project, display name, and how it was resolved (`session` / `env` / `directory` / `none`).
- `get_canon` — calls `POST /api/context/canon`. Canon only: no focus document, no RAG, no LLM. What an agent calls at the top of a conversation.
- `compose_context` — calls `POST /api/context/compose`. The full payload for a known ticket.
- `ingest_paste` — calls `POST /api/ingest/paste`. Defaults `projectSlug` to the active project.
- `search` — calls `POST /api/search`. Defaults `projectSlug` to the active project. Errors loudly if no active project and none passed.

### Always-on context

The server advertises `instructions` (see `packages/mcp-server/src/instructions.ts`) during the MCP `initialize` handshake. The host injects that block before the first user turn, so the "resolve the project, then read the canon" contract reaches every new conversation on every machine without committing anything to a project repo. Per-project content belongs in the canon itself, never in this block.

The active project resolves in this order: an explicit `set_active_project` call > `WORKBRAIN_PROJECT_SLUG` > a binding previously saved for the current working directory (longest matching prefix, so subdirectories inherit). Bindings live in `~/.workbrain/state.json`, overridable with `WORKBRAIN_STATE_FILE`. There is deliberately no "last project used" fallback: clients are siloed, and resolving to whatever was touched last would surface one client's context inside another client's repo.

## Where each client's data lives

Every client declares how isolated it needs to be. The setting lives on the
`clients` row and decides three things: where the corpus is stored, which
account processes its text, and which credentials can reach it.

| | Shared | Dedicated |
|---|---|---|
| Corpus lives in | the central database, alongside other shared clients | a database of its own |
| Answer to *"is my data in the same database as your other clients?"* | no other client's rows are returned, but yes, same database | **no** |
| Costs you | nothing | ~USD 1-2/month on Neon |
| Set up with | nothing — it's the default | `db:isolate <client>` |

`shared` is the default and reproduces the behaviour that existed before this
mechanism, so nothing moves until you deliberately move it.

### What lives where

The **central** database holds the registry and the account: `users`,
`api_keys`, `signup_tokens`, `canon_domains`, `clients`, `projects`.

A **client's** database holds its content: `documents`, `chunks`,
`document_links`, `stakeholders`, `draft_documents`, `invocations`.

Postgres cannot join across databases, so any query that used to join corpus
to `projects` and `clients` is now a central lookup plus a scoped corpus
query. Ownership is still proven — by scoping to the project ids the registry
says live in that database. Corpus reads and writes must go through
`corpusDbFor(client)` (see `src/lib/db.ts`) or `resolveProjectContext`
(`src/lib/tenancy.ts`); reaching a corpus table through the central handle is
the one mistake this design cannot catch for you.

Each dedicated database also holds a copy of its own `clients` row and its
`projects` rows. Nothing reads them — the central registry stays
authoritative — they exist so the corpus tables' foreign keys resolve, and so
a dedicated database is a coherent, restorable thing on its own.

### Limiting an API key to one client

A key can be pinned to a single client when you create it (Account → API
keys → *Can reach*). A pinned key can read and write that client and nothing
else: it cannot search another client's corpus, cannot list another client's
projects, and cannot even learn that they exist — a project outside the key's
reach is reported as missing, never as forbidden.

Use it for the key that lives in one client's repo. If that laptop is lost,
the blast radius is that engagement instead of every engagement. Keys created
before this existed, and keys left on "every client", keep working unchanged.

The scope is enforced in `src/lib/tenancy.ts`, and it is a **required**
argument there rather than an optional one. Optional would fail open: forget
it at one call site and a pinned key quietly gets everything. Required makes
the compiler ask at every call site, and callers that are legitimately
unscoped — the webapp, where the owner is signed in — pass `null` explicitly.

### Moving a client to its own database

The move copies and verifies everything **before** the client switches over,
so an interrupted run leaves a working system:

```bash
# 1. Copy and verify. Changes nothing; creates the Neon project when
#    NEON_API_KEY is set, or pass --url for a database you made yourself.
pnpm --filter @workbrain/web db:isolate acme

# 2. Add the connection string it prints to your environment (and to Vercel),
#    then switch the client over:
pnpm --filter @workbrain/web db:isolate acme --url "<same url>" --apply

# 3. Once you have confirmed the app reads the new database:
pnpm --filter @workbrain/web db:isolate acme --url "<same url>" --apply --purge-source
```

Secrets never enter the database: the `clients` row stores the **name** of the
environment variable holding the connection string, not the string itself.

### Two things that will bite if you forget them

- **Migrations.** `db:migrate` only touches the central database. Use
  `db:migrate:all` once any client is dedicated, or that client's schema
  falls behind the code querying it. It exits non-zero when a dedicated
  database is unreachable rather than reporting success.
- **Environment variables.** A dedicated client whose variable is missing
  makes every request for that client fail loudly. That is deliberate — the
  alternative is silently reading the shared database, which would put one
  client's corpus in with everyone else's. Run `db:isolation` before a deploy
  to see the state of all of them at once.

## Cross-project isolation

Cross-client leakage is the single worst possible bug for this product. Three
things guard against it, at three different distances.

**The query itself.** `src/lib/search.test.ts` renders the real chunk query
through drizzle's `.toSQL()` and asserts the `project_id` filter survives every
combination of optional filters a caller can pass. No database is contacted, so
it runs in CI on every change. It is a real guard, not a decorative one: delete
the filter and ten tests fail.

**The routing.** `src/lib/tenancy.test.ts` pins the rule that a client's
projects never land in another client's target, on shared and dedicated storage
alike, and that a scoped API key sees neither the projects nor the labels of
clients it may not reach.

**The record.** Databases can be perfectly separated and the mixing still
happen one level up, in the agent's context window: a chat loads one client's
canon, the user changes directory, and it carries on for another with the first
still in the window. WorkBrain does not control that window, but every
invocation carries the chat's session id, so a session that spanned two clients
is detectable after the fact:

```bash
pnpm --filter @workbrain/web check:sessions            # all time
pnpm --filter @workbrain/web check:sessions --days 30  # recent only
```

It exits non-zero when it finds one, so it can gate a release. Two projects of
the *same* client are normal work and are not reported.

You can still check by hand, end to end:

```bash
# from project-y, search for content that lives only in project-x
curl -s -X POST http://localhost:3000/api/search \
  -H "Authorization: Bearer wbk_..." -H "Content-Type: application/json" \
  -d '{"projectSlug":"project-y","query":"<distinctive phrase from project-x>","minSimilarity":0.4}'
# expect: { ok: true, data: { chunks: [] } }
```

**Not guarded:** row-level security inside the shared database. It was
evaluated and deliberately skipped — see the note in
`docs/06-roadmap.md`.

## Deploying `apps/web` to Vercel + Neon (manual)

Phase 1 ships against Vercel + Neon. Steps are manual on purpose; we don't ship CI yet.

1. **Push the code repo to GitHub** (already done if you cloned from your own).
2. **Create a Vercel project**:
   - Import the GitHub repo.
   - Root directory: `apps/web`.
   - Framework preset: Next.js.
   - Build command: `pnpm --filter @workbrain/web build` (Vercel auto-detects pnpm via `packageManager`).
   - Install command: `pnpm install`.
3. **Bind the Neon project to Vercel** (recommended path):
   - In the Vercel project settings → Storage → connect your Neon project.
   - Vercel auto-injects `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. No manual copy/paste of secrets.
   - Alternatively, paste them by hand under Settings → Environment Variables.
4. **Set the rest of the env vars** in Vercel (Production + Preview + Development as appropriate):
   - `VOYAGE_API_KEY`
   - `WORKBRAIN_API_KEYS_SALT` (generate fresh per environment with `openssl rand -hex 32`)
   - `ANTHROPIC_API_KEY` (empty for Phase 1; declared for Phase 2)
   - `WORKBRAIN_CORPUS_PATH` and `WORKBRAIN_CORPUS_REMOTE` are **dev-only**. The deployed backend doesn't manage the corpus — that flow is local Phase-1 only. Document the limitation; revisit when the corpus moves server-side in Phase 4+.
5. **Trigger a deploy**. Once the build succeeds, run a one-off migration against the Neon production database:
   ```bash
   DATABASE_URL_UNPOOLED="<prod direct conn>" pnpm --filter @workbrain/web db:migrate
   ```
   Drizzle's migration ledger lives in the `__drizzle_migrations` table.
6. **Generate a production API key** the same way as locally:
   ```bash
   DATABASE_URL_UNPOOLED="<prod direct conn>" \
   WORKBRAIN_API_KEYS_SALT="<prod salt, must match Vercel env>" \
     pnpm --filter @workbrain/web exec tsx scripts/generate-api-key.ts <email> "production"
   ```
7. **Point the MCP server at production** by editing `.mcp.json` to set `WORKBRAIN_API_URL=https://<your-vercel-url>` and the production key. Reload the IDE.

## Troubleshooting

- **`pnpm install` adds `drizzle-orm` twice in `.pnpm/`.** The `.npmrc` at the repo root hoists `drizzle-orm` and `@neondatabase/*` to deduplicate the type graph across workspaces. If you remove that file, TypeScript will report `SQL<unknown>` mismatch errors on every Drizzle query that crosses package boundaries. Keep it.
- **Migrations fail with "vector type does not exist".** The first migration (`drizzle/0000_initial.sql`) starts with `CREATE EXTENSION IF NOT EXISTS vector;`. If you regenerate migrations, re-add that line — `drizzle-kit` doesn't emit it.
- **MCP tools never show up in the IDE.** Use absolute paths in `.mcp.json` and `.cursor/mcp.json`. Cursor and VS Code don't load your shell rc files, so bare `node` won't be found. Resolve with `readlink -f $(which node)`.
- **`HTTP 401`** from any tool. The `wbk_` key is wrong or expired. Generate a new one with `scripts/generate-api-key.ts`.
- **`HTTP 404 project_not_found`**. Run `db:seed:dev` (placeholders) or `db:seed:projects` (real), then call `set_active_project` again.
- **Search returns chunks across projects.** Should be impossible; if it happens, file an issue. The `project_id` filter is asserted in `apps/web/src/lib/search.ts` and end-to-end via the four-way isolation matrix in this repo's history.
- **Corpus push fails with auth error.** `gh auth setup-git` to wire `gh` as the credential helper for GitHub HTTPS pushes. The corpus commit step swallows push errors so an ingest still succeeds in the database — re-push later with `git -C corpus push`.

## Spec deltas vs design doc

Decisions revised against [`docs/04-workbrain-design-final.md`](docs/04-workbrain-design-final.md) Section 2, with explicit user approval before changing them:

- **Neon plan:** "Pro (USD 19/month)" → **Launch (~USD 15/month)**. Neon retired the Pro tier; Launch provides 7-day point-in-time recovery, satisfying the brief's non-negotiable PITR requirement.
- **Node version:** "20 LTS" → **22 LTS**. Vercel default is now 22, LTS support extends 12 months further, no stack dependency requires 20.
- **API key hashing:** plain `SHA256(key)` → **`HMAC-SHA256(salt, key)`** using `WORKBRAIN_API_KEYS_SALT`. The salt was already declared in `.env.example` — using it is defense-in-depth at zero cost.

## Phase 1 Definition of Done

The checklist from `docs/04-workbrain-design-final.md` Section 15:

1. ✅ Paste ingestion via the `ingest_paste` MCP tool from inside Cursor / VS Code.
2. ✅ Semantic search returns chunks scoped to the active project.
3. ✅ Cross-project isolation verified end-to-end (a query for project-x content returns zero from project-y).
4. ✅ The corpus folder mirrors disk paths with frontmatter and pushes to the private corpus repo.
5. ✅ Neon stores `documents` and `chunks` rows with denormalized `client_id` and `project_id`.
6. ✅ Every API call produces an `invocations` audit row.
7. ✅ This README walks a fresh reader from `git clone` to a working ingest in ≤30 minutes.

## What's next

Phase 1 ships the functional skeleton. Phase 2+ adds: auto-classification of pasted content, Voyage `rerank-2` in search, the `compose_context` flagship operation, the management webapp, live connectors (Jira, Confluence, Teams, Outlook), multi-tenant signup with Clerk, and BYOK billing. See [`docs/02-workbrain-implementation-brief.md`](docs/02-workbrain-implementation-brief.md).
