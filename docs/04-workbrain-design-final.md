# WorkBrain — Final Design Document & Phase 1 Build Spec

> This is the executable design contract for the construction of WorkBrain. It is meant to be read by a coding agent (Claude Code or Cursor) at the start of a build session. Anything in this document is committed; anything not in this document must be raised as a question before code is written.
>
> **Companion documents (in the Project, not duplicated here):**
> - `01-project-instructions.md` — collaboration rules and economic context
> - `02-workbrain-implementation-brief.md` — full multi-phase roadmap and rationale
> - `03-workbrain-product-vision.md` — product framing and JTBD
>
> This document does NOT replace those. It assumes you have read them. It locks down the decisions needed to start coding Phase 1.

---

## 0. Read this first — coding agent operating rules

You are about to build WorkBrain. Before you write a single line of code, follow these rules:

1. **Ask first, code second.** Section 14 of this document lists the questions you MUST ask the user before generating any file. Ask them all, wait for answers, then proceed. Do not assume answers from this document where Section 14 says "ask the user". The user has explicitly asked to be asked.

2. **English only in code and artifacts.** All code, comments, commit messages, file names, variable names, log messages, error strings, README files, and SQL are in English. Conversation with the user happens in Spanish, but no Spanish leaks into the repository.

3. **Phase 1 only.** This document describes Phase 1 in executable detail. Phases 2 through 6 are mentioned only as "do not build this yet" guardrails. Do not pre-implement Phase 2 features even if they seem like a small extra.

4. **The brief is canon.** If anything in this document conflicts with `02-workbrain-implementation-brief.md`, raise the conflict and ask the user. Do not silently resolve it.

5. **Stop and ask when uncertain.** If a decision is missing, raise it. Better to interrupt the user with a question than to commit a wrong assumption.

6. **No silent dependencies.** Every package you add to `package.json` must be justified in your message before you run `pnpm add`. If the user has not seen the package name, mention it.

7. **Verify before claiming done.** A Phase 1 task is done when its acceptance criterion (Section 11) passes, not when the code compiles.

---

## 1. Purpose and scope of Phase 1

WorkBrain is a multi-client project memory layer for Cursor and Claude Code, consumed via MCP. The full product is described in the companion documents.

Phase 1 builds the **functional skeleton**: paste ingestion plus semantic search, end to end, for two pilot projects, consumable from Cursor and Claude Code.

At the end of Phase 1 the user can:

1. Paste a ticket or document into Cursor with the MCP tool `ingest_paste`, choosing the type manually.
2. The document is stored as markdown on disk and indexed in Postgres with embeddings.
3. Call `search "some technical phrase"` and get back relevant chunks, filtered by the active project.
4. Switch active project with `set_active_project` and confirm cross-project isolation.

Phase 1 deliberately does NOT include:

- Auto-classification of pasted content (Phase 2)
- Voyage rerank-2 in the search pipeline (Phase 2)
- The `compose_context` flagship operation (Phase 2)
- Any `draft_*` tools (Phase 3)
- The management webapp (Phase 4)
- Any live connector to Jira, Confluence, Outlook, Teams (Phase 5)
- Multi-tenant signup, billing, Clerk auth (Phase 6)

If a Phase 2+ feature appears tempting during Phase 1 work, do not build it. Note it as a TODO and continue.

---

## 2. Locked decisions

These decisions are closed. Do not re-litigate them; if the user wants to change one, they will say so.

| Decision | Value | Reason |
|---|---|---|
| Public name | WorkBrain | Domain `workbrain.app` is owned by the user. Used as product name, package scope, and MCP server name. |
| Repository layout | Single monorepo, pnpm workspaces, no turborepo or nx | Three packages do not justify a build orchestrator. Adds complexity for no gain at this scale. |
| Package manager | pnpm | Fastest, smallest disk footprint, best workspace support. |
| Backend framework | Next.js 15 with App Router, deployed on Vercel | Locked in the brief. |
| Database | Postgres on Neon, Pro tier (USD 19/month) | Locked in the brief. Point-in-time recovery is non-negotiable. |
| Vector store | pgvector in the same Neon instance, HNSW index with `vector_cosine_ops` | Locked in the brief. Avoids a second managed service. |
| ORM | Drizzle | Locked in the brief. Schema-first, typed, no runtime overhead. |
| Embeddings provider | Voyage 3 Large, 1024 dimensions | Locked in the brief. `input_type: document` for indexing, `query` for retrieval. |
| MCP server transport | stdio | Required for Cursor and Claude Code local consumption. |
| MCP server auth to backend | Static API key per user, sent as `Authorization: Bearer <key>` header | Decided here. Generated by a CLI script in Phase 1, by the webapp in Phase 4, migrated to Clerk in Phase 6. |
| Backend auth (webapp, future) | Signed cookie with `jose` | Locked in the brief, not built in Phase 1. |
| Slugs for client and project | Placeholder `client-a/project-x` and `client-a/project-y` during development, real slugs entered via interactive seed script at end of Phase 1 | Decided here. Avoids freezing names prematurely. |
| TypeScript | Strict mode, ES2022 target, ESM | Standard for the user's stack. |
| Linting / formatting | Biome (single tool replaces eslint + prettier) | Decided here. Reduces config sprawl. |
| Testing framework | Vitest | Decided here. Native ESM, fast, integrates cleanly with Next.js. |
| Git hosting | Private GitHub repo named `workbrain` under the user's account | The user will create the repo and add the remote; the agent does not create GitHub repos. |
| Node version | 20 LTS (declared in `.nvmrc` and `engines`) | Stable, supported through 2026. |
| License | Private, no open-source license file | Product is commercial. |

---

## 3. Repository layout

The monorepo lives at the root of a directory the user will create, named `workbrain`.

```
workbrain/
├── .nvmrc                             # "20"
├── .gitignore
├── .env.example                       # template, committed
├── .env.local                         # real secrets, gitignored
├── biome.json                         # lint + format config
├── package.json                       # root, defines workspaces
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json                 # shared TS config, extended by each package
├── README.md                          # build, dev, deploy instructions
│
├── apps/
│   └── web/                           # Next.js 15 app: API routes (Phase 1) + webapp (Phase 4)
│       ├── package.json
│       ├── tsconfig.json
│       ├── next.config.ts
│       ├── drizzle.config.ts          # Drizzle CLI config
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx
│       │   │   ├── page.tsx           # placeholder landing for Phase 1
│       │   │   └── api/
│       │   │       ├── ingest/
│       │   │       │   └── paste/
│       │   │       │       └── route.ts
│       │   │       ├── search/
│       │   │       │   └── route.ts
│       │   │       └── projects/
│       │   │           └── route.ts   # GET only in Phase 1
│       │   ├── lib/
│       │   │   ├── auth.ts            # API key validation middleware
│       │   │   ├── db.ts              # Drizzle client
│       │   │   ├── embeddings.ts      # Voyage client
│       │   │   ├── chunking.ts        # natural paragraph chunker
│       │   │   ├── corpus.ts          # write/read .md files on disk
│       │   │   └── git.ts             # commit + push to private corpus repo
│       │   └── middleware.ts          # API key check on /api/*
│       └── scripts/
│           ├── migrate.ts             # run Drizzle migrations
│           ├── seed-dev.ts            # placeholder client-a/project-x seed
│           ├── seed-projects.ts       # interactive prompt for real slugs
│           └── generate-api-key.ts    # creates a user + API key, prints once
│
├── packages/
│   ├── shared/                        # types, schema, constants used by both apps/web and packages/mcp-server
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts               # re-exports
│   │       ├── schema.ts              # Drizzle schema (single source of truth)
│   │       ├── types.ts               # API request/response types
│   │       ├── constants.ts           # document types, link types, etc.
│   │       └── frontmatter.ts         # parse + serialize YAML frontmatter
│   │
│   └── mcp-server/                    # local Node MCP server
│       ├── package.json
│       ├── tsconfig.json
│       ├── README.md                  # install + Cursor/Claude Code config
│       └── src/
│           ├── index.ts               # entry: starts MCP stdio server
│           ├── tools/
│           │   ├── ingest-paste.ts
│           │   ├── search.ts
│           │   ├── set-active-project.ts
│           │   └── current-project.ts
│           ├── client.ts              # HTTP client to apps/web backend
│           ├── state.ts               # in-memory active project per session
│           └── config.ts              # reads WORKBRAIN_API_URL, WORKBRAIN_API_KEY env vars
│
├── corpus/                            # local markdown corpus, gitignored from this repo
│                                       # this is a SEPARATE git repo the user pushes to a private GitHub repo
│                                       # workbrain itself does not version client data
│   └── (created at first ingest)
│
└── drizzle/                           # generated migration files, committed
    ├── 0000_initial.sql
    └── meta/
```

Two important notes on the corpus directory:

1. The `corpus/` folder lives inside the `workbrain` directory but is **not** part of the WorkBrain git repo. It is a separate git repo that the user pushes to their own private GitHub repo (the user will create it). This keeps client data out of any future WorkBrain code repository.
2. The path of the corpus directory is configurable via `WORKBRAIN_CORPUS_PATH` environment variable. The default is `./corpus` relative to the backend.

---

## 4. Environment variables

Single source of truth: `apps/web/.env.local` (gitignored) and `apps/web/.env.example` (committed, no real values).

```bash
# apps/web/.env.example

# Database
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"

# Voyage AI
VOYAGE_API_KEY="pa-..."

# Anthropic (not used in Phase 1, declared for Phase 2)
ANTHROPIC_API_KEY=""

# Corpus storage
WORKBRAIN_CORPUS_PATH="./corpus"

# Auth
WORKBRAIN_API_KEYS_SALT="generate-with-openssl-rand-hex-32"

# Environment
NODE_ENV="development"
```

The MCP server has its own env vars, set in the user's Cursor / Claude Code config:

```json
{
  "mcpServers": {
    "workbrain": {
      "command": "node",
      "args": ["/absolute/path/to/workbrain/packages/mcp-server/dist/index.js"],
      "env": {
        "WORKBRAIN_API_URL": "http://localhost:3000",
        "WORKBRAIN_API_KEY": "wbk_..."
      }
    }
  }
}
```

---

## 5. Database schema (Drizzle)

The schema below is the Phase 1 minimum. The full schema from the brief (including `documentLinks`, `invocations`, `stakeholders`) is implemented as tables but only the Phase 1 columns are populated. Tables that are not used in Phase 1 are still created so future phases do not require schema migrations on top of an in-use database.

File: `packages/shared/src/schema.ts`

```ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  vector,
  index,
} from "drizzle-orm/pg-core";

// -----------------------------
// Auth (Phase 1: minimum for API key validation)
// -----------------------------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull().unique(), // sha256 of the raw key
  label: text("label").notNull(), // e.g. "laptop-cursor"
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("api_keys_user_idx").on(t.userId),
}));

// -----------------------------
// Tenancy
// -----------------------------
export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userSlugIdx: index("clients_user_slug_idx").on(t.userId, t.slug),
}));

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clients.id),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  persist: boolean("persist").notNull().default(true),
  conventions: text("conventions"),
  guidelines: text("guidelines"),
  architecture: text("architecture"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  clientSlugIdx: index("projects_client_slug_idx").on(t.clientId, t.slug),
}));

// -----------------------------
// Corpus
// -----------------------------
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  type: text("type").notNull(),
  externalId: text("external_id"),
  path: text("path").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  frontmatter: jsonb("frontmatter").notNull().default({}),
  status: text("status"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  projectIdx: index("doc_project_idx").on(t.projectId),
  typeIdx: index("doc_type_idx").on(t.type),
  externalIdIdx: index("doc_external_id_idx").on(t.externalId),
}));

export const documentLinks = pgTable("document_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromDocumentId: uuid("from_document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  toDocumentId: uuid("to_document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  linkType: text("link_type").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  fromIdx: index("doc_links_from_idx").on(t.fromDocumentId),
  toIdx: index("doc_links_to_idx").on(t.toDocumentId),
}));

export const chunks = pgTable("chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  clientId: uuid("client_id").notNull().references(() => clients.id),
  type: text("type").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  tokenCount: integer("token_count").notNull(),
  embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  embeddingIdx: index("chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  projectIdx: index("chunks_project_idx").on(t.projectId),
  clientIdx: index("chunks_client_idx").on(t.clientId),
}));

// -----------------------------
// Audit (Phase 1: created but only minimal rows on every API call)
// -----------------------------
export const invocations = pgTable("invocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  projectId: uuid("project_id").references(() => projects.id),
  operation: text("operation").notNull(),
  userPrompt: text("user_prompt").notNull(),
  systemPrompt: text("system_prompt").notNull().default(""),
  retrievedChunks: jsonb("retrieved_chunks").notNull().default([]),
  provider: text("provider").notNull().default("none"),
  model: text("model").notNull().default("none"),
  responseText: text("response_text"),
  status: text("status").notNull(),
  errorDetail: text("error_detail"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  costUsd: text("cost_usd"),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  projectIdx: index("invocations_project_idx").on(t.projectId),
  createdAtIdx: index("invocations_created_at_idx").on(t.createdAt),
}));

// -----------------------------
// Stakeholders (Phase 2+, table created, empty in Phase 1)
// -----------------------------
export const stakeholders = pgTable("stakeholders", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  role: text("role"),
  communicationStyle: text("communication_style"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

---

## 6. API contracts (Phase 1)

All endpoints live under `apps/web/src/app/api/`. All requests require the header `Authorization: Bearer <api-key>`. The middleware at `apps/web/src/middleware.ts` rejects unauthenticated requests with 401.

All responses follow this shape:

```ts
type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; detail?: unknown } };
```

### `POST /api/ingest/paste`

**Request body:**
```ts
{
  projectSlug: string;        // required, must exist for the authenticated user
  type:                       // required in Phase 1 (no auto-classification yet)
    | "ticket"
    | "confluence"
    | "teams_thread"
    | "email"
    | "transcript"
    | "decision"
    | "convention"
    | "guideline"
    | "stakeholder"
    | "task"
    | "note";
  title: string;              // required
  content: string;            // required, raw markdown body (no frontmatter)
  externalId?: string;        // e.g. "TICKET-1234"
  status?: "open" | "in_progress" | "resolved";
  tags?: string[];
  relatedTickets?: string[];  // external IDs, used to populate frontmatter
}
```

**Behavior:**
1. Validate that `projectSlug` belongs to the authenticated user.
2. Generate frontmatter from inputs plus `created`, `updated`, `persist` (from project).
3. Generate path: `{client-slug}/{project-slug}/{type-folder}/{external-id-or-slugified-title}.md` where `type-folder` is `tickets/`, `confluence/`, `teams/`, `emails/`, `transcripts/`, `decisions/`, or the type itself for the rest.
4. Write `.md` file to `WORKBRAIN_CORPUS_PATH/{path}` with frontmatter + content.
5. Insert row in `documents` table.
6. Chunk content by natural paragraphs using `lib/chunking.ts` rules (Section 8).
7. Batch-embed chunks via Voyage (`input_type: "document"`).
8. Insert rows in `chunks` table with denormalized `client_id`, `project_id`, `type`.
9. Commit + push corpus repo via `lib/git.ts` (best effort, log errors but do not fail the request).
10. Insert audit row in `invocations` with `operation: "ingest_paste"`, `status: "success"`, `provider: "none"`, `model: "none"`.
11. Return `{ documentId, path, frontmatter, chunkCount }`.

**Response (success):**
```ts
{
  ok: true;
  data: {
    documentId: string;
    path: string;
    frontmatter: Record<string, unknown>;
    chunkCount: number;
  }
}
```

### `POST /api/search`

**Request body:**
```ts
{
  query: string;              // required
  projectSlug: string;        // required, NEVER optional in Phase 1
  types?: string[];           // optional filter on document type
  topK?: number;              // default 8, max 50
  minSimilarity?: number;     // default 0.3
}
```

**Behavior:**
1. Resolve `projectSlug` to `projectId` for the authenticated user. If not found, 404.
2. Embed `query` via Voyage (`input_type: "query"`).
3. Run cosine similarity over `chunks` filtered by `project_id`. NEVER omit the project filter.
4. Optionally filter by `types`.
5. Return top-K chunks above `minSimilarity`.
6. Insert audit row in `invocations` with `operation: "search"`, `retrievedChunks` populated.

**Response (success):**
```ts
{
  ok: true;
  data: {
    chunks: Array<{
      documentId: string;
      documentPath: string;
      documentTitle: string;
      externalId: string | null;
      type: string;
      text: string;
      similarity: number;
    }>;
  }
}
```

### `GET /api/projects`

**Behavior:**
List all projects for the authenticated user, joined with their client.

**Response (success):**
```ts
{
  ok: true;
  data: Array<{
    projectId: string;
    projectSlug: string;
    projectName: string;
    clientId: string;
    clientSlug: string;
    clientName: string;
    persist: boolean;
  }>;
}
```

---

## 7. MCP tool contracts (Phase 1)

The MCP server exposes four tools. Each tool calls the corresponding backend endpoint via `lib/client.ts`. All tools require a successfully authenticated backend; failures bubble up as MCP errors with the backend's error message.

### `ingest_paste`

Input schema (Zod, declared in MCP tool definition):
```ts
{
  type: enum([...11 types]),
  title: string,
  content: string,
  externalId?: string,
  status?: enum(["open", "in_progress", "resolved"]),
  tags?: string[],
  relatedTickets?: string[],
  projectSlug?: string,        // optional; defaults to active project from state
}
```

Returns the same shape as the backend response.

### `search`

Input schema:
```ts
{
  query: string,
  types?: string[],
  topK?: number,
  minSimilarity?: number,
  projectSlug?: string,        // optional; defaults to active project
}
```

If `projectSlug` is not provided and no active project is set, return an explicit error: `"No active project. Call set_active_project first."`

### `set_active_project`

Input schema:
```ts
{
  projectSlug: string,
}
```

Stores the slug in `state.ts` (in-memory, per MCP process). Validates against `/api/projects` that the slug exists.

### `current_project`

No input. Returns:
```ts
{ projectSlug: string | null, projectName: string | null }
```

---

## 8. Chunking strategy

Implemented in `apps/web/src/lib/chunking.ts`.

**Algorithm:**
1. Split the markdown body by double newlines (paragraph boundaries).
2. For each paragraph:
   - If it is a heading (`#`, `##`, `###`, etc.), keep it as a separate chunk regardless of length.
   - If it is shorter than 20 characters and not a heading, discard it.
   - If it is longer than 1000 tokens (counted approximately as `Math.ceil(text.length / 4)`), split by single newlines or, failing that, by sentence boundary, never inside a code block.
3. Token count for each chunk is `Math.ceil(chunk.length / 4)` for Phase 1 (good-enough approximation; precise counting deferred).
4. Code blocks (delimited by triple backticks) are kept together as a single chunk even if long, unless they exceed 2000 tokens, in which case split by line groups.

This is the rule: **chunk by meaning, not by window**.

---

## 9. Voyage integration

File: `apps/web/src/lib/embeddings.ts`.

```ts
async function embed(
  texts: string[],
  inputType: "document" | "query"
): Promise<number[][]>;
```

- Endpoint: `https://api.voyageai.com/v1/embeddings`
- Model: `voyage-3-large`
- `input_type` is mandatory and explicit. Do not default it.
- Batch up to 128 texts per request.
- Retry on 429 with exponential backoff, max 3 retries.
- On final failure, throw `VoyageError` with the response body.

---

## 10. Authentication flow (Phase 1)

1. User runs `pnpm --filter web exec tsx scripts/generate-api-key.ts <email> <label>`.
2. The script:
   - Creates a user in `users` if email not present.
   - Generates a random key prefixed with `wbk_` (32 random bytes hex-encoded).
   - Stores `sha256(key)` in `api_keys` along with the label.
   - Prints the raw key once to stdout. The user pastes it into Cursor / Claude Code MCP config.
3. Every API request hits `apps/web/src/middleware.ts`, which:
   - Reads `Authorization: Bearer <key>`.
   - Hashes and looks up in `api_keys`.
   - If found, attaches `userId` to request headers via `request.headers.set("x-user-id", ...)` for downstream handlers.
   - Updates `lastUsedAt`.
   - If not found, returns 401.

---

## 11. Phase 1 task checklist with acceptance criteria

Tasks are ordered. Do not skip ahead. Each task ends with an acceptance criterion that must be demonstrated to the user (a curl command, a screenshot, a test run) before moving on.

### Task 1.1 — Repo scaffolding
- Initialize pnpm monorepo with workspaces.
- Create `apps/web`, `packages/shared`, `packages/mcp-server`.
- Configure `tsconfig.base.json`, `biome.json`, `.nvmrc`, root `package.json` scripts.
- Initial commit.

**Done when:** `pnpm install` runs clean, `pnpm typecheck` passes (empty packages compile), `pnpm format` runs.

### Task 1.2 — Drizzle schema and migrations
- Implement `packages/shared/src/schema.ts` per Section 5.
- Configure `drizzle.config.ts` in `apps/web`.
- Generate the initial migration into `drizzle/0000_initial.sql`.
- Implement `apps/web/scripts/migrate.ts`.

**Done when:** running `pnpm --filter web db:migrate` against a Neon dev database creates all tables, including the HNSW index on `chunks.embedding`.

### Task 1.3 — API key generation script
- Implement `apps/web/scripts/generate-api-key.ts`.
- Implement `apps/web/src/middleware.ts` with API key validation.

**Done when:** running the script prints a key, hitting any `/api/*` route without the key returns 401, hitting it with the key returns the route's response (use a stub route for the test).

### Task 1.4 — Voyage embeddings client
- Implement `apps/web/src/lib/embeddings.ts`.
- Implement basic Vitest unit test that mocks `fetch` and verifies `input_type` is sent correctly.

**Done when:** the unit test passes; a manual integration test embedding a single string returns a 1024-length vector.

### Task 1.5 — Chunking
- Implement `apps/web/src/lib/chunking.ts` per Section 8.
- Vitest unit tests for: paragraph splitting, heading preservation, code block preservation, short paragraph rejection.

**Done when:** all unit tests pass.

### Task 1.6 — Frontmatter
- Implement `packages/shared/src/frontmatter.ts` with `parse(md)` and `serialize(content, fm)`.
- Use a small, well-known YAML library. Mention which one before adding it.

**Done when:** unit tests roundtrip a sample document with all the frontmatter fields described in `02-workbrain-implementation-brief.md`.

### Task 1.7 — Corpus filesystem layer
- Implement `apps/web/src/lib/corpus.ts` with `writeDocument(path, frontmatter, content)` and `readDocument(path)`.
- Implement `apps/web/src/lib/git.ts` with `commitAndPush(path, message)`. Git operations run in a child process. Failures are logged but do not throw.

**Done when:** writing a document creates the file at the right path inside `WORKBRAIN_CORPUS_PATH`, the git commit appears in `git log`, the push succeeds against a configured private remote.

### Task 1.8 — Seed dev data
- Implement `apps/web/scripts/seed-dev.ts` that creates:
  - One user (test email).
  - One client `client-a` with `name: "Client A (placeholder)"`.
  - Two projects: `project-x` and `project-y` under `client-a`.
- Idempotent (re-running does not duplicate).

**Done when:** running `pnpm --filter web db:seed:dev` populates the database; `GET /api/projects` returns both projects.

### Task 1.9 — `POST /api/ingest/paste`
- Implement the route per Section 6.
- Wire chunking, embedding, document insert, chunks insert, file write, git commit.
- Insert audit row.

**Done when:** a curl request with a valid API key, a sample ticket payload, and `projectSlug: "project-x"` returns 200, the file is on disk, the document and chunks are in the database, and `GET /api/projects` still works.

### Task 1.10 — `POST /api/search`
- Implement the route per Section 6.
- Use raw SQL via Drizzle's `sql` helper for the cosine similarity query (`<=>` operator with pgvector).
- Filter by `project_id` always. Add a unit test that fails if a search returns chunks from a different project.

**Done when:** searching for a phrase from the ticket inserted in Task 1.9 returns the relevant chunk; searching with `projectSlug: "project-y"` returns zero results (cross-project isolation verified).

### Task 1.11 — MCP server scaffolding
- Implement `packages/mcp-server/src/index.ts` using `@modelcontextprotocol/sdk` with stdio transport.
- Implement `packages/mcp-server/src/client.ts` (HTTP client with `Authorization` header).
- Implement `packages/mcp-server/src/state.ts` (in-memory active project).
- Implement `packages/mcp-server/src/config.ts` (read env vars, fail loud if missing).
- Build script: compile to `packages/mcp-server/dist/index.js`.

**Done when:** `node packages/mcp-server/dist/index.js` starts without errors and accepts `tools/list` requests over stdio (test with the official MCP inspector).

### Task 1.12 — MCP tools
- Implement the four tools per Section 7.

**Done when:** the MCP inspector lists all four tools, calling `set_active_project` then `search` returns chunks from the active project.

### Task 1.13 — Cursor + Claude Code integration
- Document in `packages/mcp-server/README.md` how to add WorkBrain to Cursor's `mcp.json` and Claude Code's MCP config.
- Verify locally that the user can invoke `ingest_paste` and `search` from inside Cursor.

**Done when:** the user reports that the tools are visible in Cursor and a real ingest + search cycle works end to end.

### Task 1.14 — Real seed via interactive script
- Implement `apps/web/scripts/seed-projects.ts` that prompts the user for client and project names and slugs, validates uniqueness, and inserts.
- Update the placeholder `client-a/project-x/project-y` to whatever the user enters, OR archive them (user choice during the script).

**Done when:** the user runs the script and confirms their real two pilot projects exist; placeholder data is either renamed or archived.

### Task 1.15 — README and DX polish
- Root `README.md` with install + dev commands.
- Document the API key generation flow.
- Document how to deploy `apps/web` to Vercel and Neon (manual steps, not automated).

**Done when:** the user can hand the repo to themselves on a fresh laptop and get to a working ingest + search cycle in under 30 minutes.

---

## 12. Out of scope for Phase 1 — explicit guardrails

Do NOT implement any of these in Phase 1, even if they look like a small addition:

- LLM classification of pasted content. The user passes `type` manually.
- Voyage rerank-2.
- The `compose_context` operation.
- The `ingest_url` operation. URLs go through `ingest_paste` after the user copies the text manually.
- The `record_decision`, `link_documents`, `list_recent`, `list_open` MCP tools.
- Any `draft_*` tool.
- Any UI in the webapp beyond a placeholder landing page on `/`.
- Webapp authentication (signed cookie). Phase 1 only protects `/api/*` with the API key middleware.
- Stakeholder data. The table is created and stays empty.
- Document links. The table is created and stays empty.
- Multi-provider LLM routing.
- Stripe, billing, Clerk, signup flows.
- Any connector to Jira, Confluence, Teams, Outlook.

If the user asks for one of these mid-Phase-1, finish the current task, ask the user whether to scope-creep Phase 1 or note as a Phase 2 TODO.

---

## 13. Conventions for the WorkBrain repo itself

- **Commits:** Conventional Commits format: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`. Phase 1 lives on `main`. No PRs in Phase 1; the user is the only committer.
- **Branches:** Phase 1 work happens directly on `main`. Phase 2 onward will branch.
- **Lint:** `pnpm format` runs Biome on the whole repo. Run before every commit.
- **Types:** No `any`, no `as` assertions outside test files. Use `unknown` and narrow.
- **Errors:** Backend always returns `ApiResponse<T>`. MCP server surfaces errors as MCP errors with the backend's `error.message`.
- **Logging:** `console.log` for dev. Structured logging deferred.
- **Tests:** Vitest. Phase 1 minimum: chunking, frontmatter, embeddings client, cross-project isolation in search. Coverage is not a target; correctness on these four is.
- **No premature abstractions.** Phase 1 is concrete code in concrete files. Resist factoring shared utilities until the same code appears in three places.

---

## 14. Questions to ask the user before writing any code

The coding agent must ask these questions in a single message at the start of the session. Wait for all answers before scaffolding anything.

1. **Neon project.** Has the user already created a Neon project for WorkBrain? If yes, request the connection string. If no, explain that they need to create one (Pro tier, USD 19/month) and provide the URL: https://console.neon.tech.

2. **Voyage API key.** Has the user generated a Voyage API key? If yes, request it. If no, point to https://www.voyageai.com.

3. **Corpus git remote.** Has the user created a private GitHub repo for the corpus (separate from the WorkBrain code repo)? If yes, request the SSH or HTTPS URL. If no, explain that they need one for the corpus folder, and that the WorkBrain code repo is a different one.

4. **WorkBrain code repo.** Has the user created the private GitHub repo for the WorkBrain code itself? If yes, request the URL so the agent can set the remote. If no, explain that they should create one before the first commit.

5. **Local dev port.** Does the user have anything else running on `localhost:3000`? If yes, propose `3100` as the WorkBrain dev port.

6. **Email for the first user record.** What email should be the user's identity in the `users` table? Used only as an identifier in Phase 1.

7. **Operating system.** macOS, Linux, or Windows? Affects shell commands in scripts and the path separator handling in `corpus.ts`.

8. **Cursor and Claude Code paths.** Where are the MCP config files for Cursor and Claude Code on the user's machine? The agent needs to know to write the integration docs and optionally to write the config directly. Default locations:
   - Cursor: `~/.cursor/mcp.json` (or workspace-level `.cursor/mcp.json`)
   - Claude Code: `~/.config/claude-code/mcp.json` (varies by OS — confirm with user)

9. **Anything in `02-workbrain-implementation-brief.md` the user disagrees with.** This is the last chance to surface disagreements before code lands.

10. **Anything in this document the user disagrees with.** Same reason.

After receiving answers, summarize them back to the user in a single message and wait for an explicit "go" before starting Task 1.1.

---

## 15. Definition of done for Phase 1

Phase 1 is done when ALL of the following are true:

1. The user, working in Cursor or VS Code with Claude Code, can paste a real ticket into the chat with an instruction like *"ingest this as a ticket in project-x"*, and the MCP tool ingests it correctly.
2. The user can ask *"search for chunks about [some topic] in project-x"* and the MCP tool returns relevant chunks, all of which belong to project-x.
3. Switching `set_active_project` to project-y and searching the same query returns zero or different results, proving isolation.
4. The corpus folder on disk has the .md files in the right paths, with frontmatter, and is pushed to the private corpus GitHub repo.
5. The Neon database has the documents and chunks rows with denormalized `client_id` and `project_id`.
6. Every API call has produced an `invocations` row.
7. The README walks a fresh reader from `git clone` to a working ingest in 30 minutes or less.

When all seven hold, Phase 1 ships. The user reviews and confirms before any Phase 2 work begins.
