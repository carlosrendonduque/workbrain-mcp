# WorkBrain — Implementation Brief

> Technical design document for the construction of WorkBrain: a multi-client project memory layer for Cursor and Claude Code, consumed via MCP. This document is the implementation contract: what's here gets built; what isn't here gets discussed before coding.

## 1. Problem

The user works simultaneously across multiple Salesforce consulting engagements (currently four: two under one prime contractor, two under another), plus AI evaluation work, plus occasional client support in Colombia.

When a ticket arrives, the actual workflow today is:

1. Read Jira.
2. If a similar ticket comes to mind, search for it and read it.
3. Search the Teams thread where the module was discussed (40 messages).
4. Search the architecture Confluence page.
5. Open VS Code with the client repo.
6. Open Cursor or invoke Claude Code, **paste everything found**, and say "do this taking the above into account".
7. Cursor / Claude Code work. The user supervises, adjusts, commits.
8. Tomorrow the cousin ticket arrives. **Back to step 1.**

The problem is not that Cursor / Claude Code write bad code — they write well. The problem is that **they're blind to everything that lives outside the repo**: tickets, Confluence, Teams, Outlook, meeting transcripts, prior decisions, project conventions, best practices, stakeholder preferences. The user is currently the manual bus that loads that context, every time, from scratch.

WorkBrain eliminates that manual work using the **same RAG + three-context-layers pattern** adapted to multi-client and multi-source-type, and delivered via an **MCP server** that inserts itself into the IDE where the user already lives.

WorkBrain's output is not text for the user to read — it's **structured context that the coding agent consumes** to write the client's code with full grounding.

## 2. Foundational architectural decision

WorkBrain is **a hosted backend with an API + a local MCP server that consumes it**, neither a pure local app nor a pure webapp.

```
┌─────────────────────────────────────────┐
│  Backend (Next.js 15 on Vercel)         │
│  ├─ API routes (REST)                   │
│  ├─ Postgres+pgvector on Neon           │
│  ├─ Voyage embeddings + reranker        │
│  ├─ vercel/ai-sdk multi-provider        │
│  └─ Audit/persistence layer             │
└─────────────────────────────────────────┘
              ▲                ▲
              │ HTTPS          │ HTTPS
              │                │
┌─────────────┴────┐  ┌────────┴──────────┐
│ Local MCP Server │  │ Management webapp │
│ (Node.js/TS)     │  │ (Next.js)         │
│                  │  │                   │
│ Cursor / Claude  │  │ Browser:          │
│ Code consume it  │  │ - corpus browser  │
│ in VS Code       │  │ - audit trail     │
│                  │  │ - decisions edit  │
└──────────────────┘  └───────────────────┘
```

**Why this split:**

- **Hosted backend, not local.** If the laptop powers off or the user works from another machine (client offices with restricted corporate laptops), the tool remains accessible. Neon + Vercel is a known-good combo.
- **Lightweight local MCP server.** Only routes calls to the backend API. No Postgres, no embeddings. If Cursor kills it, it spins back up with no consequences. If the user changes laptops, it reinstalls in 5 minutes.
- **Separate webapp for management.** The MCP server has no UI; it's invisible — its job is to deliver context to the coding agent. Corpus browsing, manual note editing, audit, and project configuration live in the webapp.

## 3. Consolidated stack

| Layer | Component | Notes |
|---|---|---|
| Backend API | Next.js 15 Route Handlers on Vercel | |
| DB | Postgres on Neon (Pro tier) | $19/month, point-in-time recovery |
| Vector store | pgvector in the same instance | HNSW index with `vector_cosine_ops` |
| ORM | Drizzle | Schema-first, versioned migrations |
| Embeddings | Voyage 3 Large (1024 dims) | `input_type: document` to index / `query` to retrieve |
| Reranker | Voyage rerank-2 | From Phase 2, not an afterthought |
| LLMs | Anthropic / OpenAI / Google / DeepSeek via vercel/ai-sdk | |
| Backend auth | Signed cookie (jose) | Single-user initially. When WorkBrain becomes a multi-tenant product, migrate to Clerk |
| MCP server | Node.js + TypeScript + `@modelcontextprotocol/sdk` | Stdio transport for Cursor/Claude Code |
| Webapp | Next.js 15 + Tailwind + shadcn/ui | |
| `.md` file storage | Private Git + sync to backend | Source of truth |
| Backup | Automatic push to private GitHub on every save | |

## 4. Data model

### Drizzle schema (TypeScript)

```ts
// schema.ts
import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, vector, index } from "drizzle-orm/pg-core";

// Clients (the user's prime contractors and direct engagements)
export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Projects within clients
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clients.id),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  persist: boolean("persist").notNull().default(true), // false = ephemeral
  conventions: text("conventions"),    // free markdown, project firm canon
  guidelines: text("guidelines"),      // free markdown, best practices
  architecture: text("architecture"),  // free markdown, architectural overview
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Corpus documents
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  type: text("type").notNull(),
  // Supported types:
  //   "ticket"        — Jira/ServiceNow ticket
  //   "confluence"    — Confluence page
  //   "teams_thread"  — Teams thread
  //   "email"         — Outlook email
  //   "transcript"    — meeting transcript (Teams, Zoom, etc.)
  //   "decision"      — ADR / technical decision note
  //   "convention"    — convention fragment (meta files are firm canon; this is a chunk)
  //   "guideline"     — best practice
  //   "stakeholder"   — stakeholder profile
  //   "task"          — Revelo or similar evaluation task
  //   "note"          — free-form note
  externalId: text("external_id"), // e.g. "TICKET-1234"
  path: text("path").notNull(),    // logical path in the corpus
  title: text("title").notNull(),
  content: text("content").notNull(), // full markdown
  frontmatter: jsonb("frontmatter").notNull().default({}),
  status: text("status"), // tickets: "open" | "in_progress" | "resolved"
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  projectIdx: index("doc_project_idx").on(table.projectId),
  typeIdx: index("doc_type_idx").on(table.type),
  externalIdIdx: index("doc_external_id_idx").on(table.externalId),
}));

// Explicit relationships between documents (graph)
// Reinforces what RAG alone doesn't always capture: "this ticket is a cousin of that one"
export const documentLinks = pgTable("document_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromDocumentId: uuid("from_document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  toDocumentId: uuid("to_document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  linkType: text("link_type").notNull(), // "depends_on" | "related" | "supersedes" | "discusses" | "decided_in"
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  fromIdx: index("doc_links_from_idx").on(table.fromDocumentId),
  toIdx: index("doc_links_to_idx").on(table.toDocumentId),
}));

// Chunks for RAG
export const chunks = pgTable("chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id), // denormalized for fast filtering
  clientId: uuid("client_id").notNull().references(() => clients.id),    // denormalized
  type: text("type").notNull(),                                          // denormalized
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  tokenCount: integer("token_count").notNull(),
  embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  embeddingIdx: index("chunks_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  projectIdx: index("chunks_project_idx").on(table.projectId),
  clientIdx: index("chunks_client_idx").on(table.clientId),
}));

// Audit: every LLM invocation
export const invocations = pgTable("invocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id),
  operation: text("operation").notNull(),
  // "classify_paste" | "compose_context" | "search" | "draft_jira_comment" | "draft_email" | "explain" | "free_prompt"
  userPrompt: text("user_prompt").notNull(),
  systemPrompt: text("system_prompt").notNull(), // full prompt sent, persisted verbatim
  retrievedChunks: jsonb("retrieved_chunks").notNull().default([]), // [{ docId, path, similarity, rerankScore? }]
  provider: text("provider").notNull(), // "anthropic", "openai", "google", "deepseek"
  model: text("model").notNull(),
  responseText: text("response_text"),
  status: text("status").notNull(), // "success" | "error"
  errorDetail: text("error_detail"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  costUsd: text("cost_usd"), // string for precision
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  projectIdx: index("invocations_project_idx").on(table.projectId),
  createdAtIdx: index("invocations_created_at_idx").on(table.createdAt),
}));

// Stakeholders per project (communication profiles, used by drafts)
// Populated by the user when bootstrapping each project. No defaults.
export const stakeholders = pgTable("stakeholders", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  name: text("name").notNull(),
  role: text("role"),
  communicationStyle: text("communication_style"), // free markdown: tone, format, do's and don'ts
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### Corpus structure on disk / in Git

The structure below uses **placeholder names** (`client-a`, `project-x`). Actual client and project slugs are configured by the user before Phase 1.

```
~/work-corpus/
├── _meta/
│   ├── manifest.yaml              # global config, list of active projects
│   └── conventions-shared.md      # rules that apply across all clients
│
├── client-a/
│   ├── _meta/
│   │   ├── conventions.md         # client-a firm canon
│   │   └── stakeholders.md        # populated by user
│   ├── project-x/
│   │   ├── _meta/
│   │   │   ├── conventions.md     # project-x firm canon
│   │   │   ├── guidelines.md      # project-x best practices
│   │   │   ├── architecture.md    # project-x architectural overview
│   │   │   └── stakeholders.md    # populated by user
│   │   ├── tickets/
│   │   │   ├── TICKET-1234.md
│   │   │   └── TICKET-1235.md
│   │   ├── confluence/
│   │   ├── teams/
│   │   ├── emails/
│   │   ├── transcripts/
│   │   └── decisions/
│   └── project-y/
│       └── ...same structure
│
├── client-b/
│   └── ...same structure
│
└── ...
```

### Standard frontmatter

Every `.md` in the corpus has YAML frontmatter at the top. Example for a ticket (placeholder names):

```yaml
---
type: ticket
project: project-x
client: client-a
external_id: TICKET-1234
title: "Short ticket title"
status: in_progress
created: 2026-01-15
updated: 2026-02-01
stakeholders: []
related_tickets: [TICKET-1230, TICKET-1212]
related_files: [SomeController.cls, SomeService.cls]
tags: [tag1, tag2]
persist: true
---

# Document body in free markdown
```

The `stakeholders` field references entries in the project's `_meta/stakeholders.md`, which the user populates per project. The brief makes no assumptions about specific names.

## 5. Operations (API + MCP tools)

Operations are split into three tiers based on centrality to the product.

### Tier 1 — Core (Phase 1-2, this is the product)

#### `ingest_paste`

The most-used verb. The user pastes anything (ticket, Confluence excerpt, Teams thread, email, transcript, chat snippet) and it lands in the right corpus, classified, with frontmatter generated, indexed.

**Parameters:** `text`, `projectSlug?` (defaults to active project), `typeHint?`, `externalIdHint?`.

**Flow:**
1. If type wasn't given, call Claude Sonnet 4.6 to classify (ticket / confluence / teams / email / transcript / decision / note) and extract structured metadata (external_id, mentioned stakeholders, referenced tickets, referenced files, date).
2. Generate full frontmatter.
3. Generate logical path following project convention.
4. Save `.md` to disk + push to Git.
5. Insert into `documents` table.
6. If extracted metadata mentions other corpus documents (by external_id or by title), automatically create entries in `document_links`.
7. Chunk by natural paragraphs.
8. Batch embedding with Voyage `input_type: document`.
9. Insert chunks with denormalized `client_id`, `project_id`, `type`.
10. Return `{ documentId, path, externalId, frontmatter, autoLinks }`.

#### `ingest_url`

Same as `ingest_paste` but the input is a URL (public or auth-able Confluence, Jira with API token, SharePoint, shared Google Doc). Web fetch + the rest of the flow.

#### `compose_context` — the flagship operation

This is what the coding agent consumes when the user is going to work a ticket. Its job is to **leave the agent with everything it needs to know** to write well-grounded code.

**Parameters:** `projectSlug`, `focusExternalId?` (e.g. `TICKET-1234`), `focusText?` (cursor text, selection, or open question).

**Flow:**
1. Load the project's firm canon **whole** (not chunked): `_meta/conventions.md`, `_meta/guidelines.md`, `_meta/architecture.md`, `_meta/stakeholders.md`.
2. If `focusExternalId` given: load that document whole.
3. Walk `document_links` from the focus: bring related documents (depends_on, related, supersedes, decided_in) — whole if short, chunked if long.
4. Run `search` with the query built from the focus (document text or `focusText`), filtered by `projectId`.
5. If focus is a ticket, also search by `related_tickets` and `related_files` declared in frontmatter.
6. If focus touches a module or file, search for prior decisions mentioning it.
7. Compose the structured response (format below).
8. Persist the composition to `invocations` (operation = `compose_context`) even when no LLM call happened — for audit and reproducibility.

**Response format:**

```json
{
  "canon": [
    { "path": "project-x/_meta/conventions.md", "content": "..." },
    { "path": "project-x/_meta/guidelines.md", "content": "..." },
    { "path": "project-x/_meta/architecture.md", "content": "..." }
  ],
  "focus": {
    "path": "project-x/tickets/TICKET-1234.md",
    "content": "...",
    "frontmatter": { ... }
  },
  "linked": {
    "tickets": [ { "external_id": "TICKET-1230", "content": "..." } ],
    "decisions": [ ... ],
    "confluence": [ ... ],
    "teams": [ ... ],
    "emails": [ ... ],
    "transcripts": [ ... ]
  },
  "rag_chunks": [
    { "path": "...", "type": "...", "text": "...", "similarity": 0.87, "rerankScore": 0.91 }
  ],
  "stakeholders_in_scope": [
    { "name": "...", "role": "...", "communication_style": "..." }
  ],
  "instructions_for_agent": "Pre-formatted text the coding agent can use as a system addendum or as a user message."
}
```

That structure is what the MCP tool returns to the coding agent. The agent then composes its own prompt using this + the code it sees in the repo.

#### `search`

Semantic search filtered by project, for more open-ended questions or corpus exploration.

**Parameters:** `query`, `projectSlug`, `types?`, `topK?` (default 8), `minSimilarity?` (default 0.3), `useRerank?` (default true from Phase 2).

**Flow:**
1. Embed query with Voyage `input_type: query`.
2. Cosine similarity over `chunks`, filtering by `projectId` (NEVER cross-project without explicit flag).
3. If `useRerank`: pull top-50 candidates, call Voyage rerank-2, return reranked top-K.
4. Return `[{ documentPath, externalId, type, text, similarity, rerankScore? }]`.

#### `set_active_project` / `current_project`

The client switch. First-class citizen to prevent contamination. The MCP server holds in-memory state for the active project so the user doesn't have to pass it on every tool call.

### Tier 2 — Continuity (Phase 2-3, this is what makes the N+1 bug cheap)

#### `record_decision`

Save an informal note / ADR when closing a ticket or making a technical decision. No LLM call — direct write, two lines, frontmatter generated.

**Parameters:** `projectSlug`, `title`, `body`, `linksTo?` (paths or external_ids of related docs), `tags?`.

Creates an `.md` in `decisions/` with frontmatter, indexes, saves. If `linksTo` is given, populates `document_links` automatically. Next time `compose_context` is called on a related ticket, this decision shows up in `linked.decisions`.

#### `link_documents`

Manually mark that doc B depends on A, or that one ticket is a cousin of another. Reinforces the relationship graph.

**Parameters:** `fromExternalId` or `fromPath`, `toExternalId` or `toPath`, `linkType`, `note?`.

#### `list_recent`

Last N documents touched in the project. No LLM.

#### `list_open`

Tickets in `open` or `in_progress` status in the project. No LLM.

### Tier 3 — Auxiliary outputs (Phase 3+, useful but not central)

These are **closing** operations of the coding flow, not the core. When the user has finished the ticket and needs to communicate the change, these tools draft with appropriate context and tone.

#### `draft_jira_comment`

Generate a Jira comment to close/update a ticket. Brings ticket context + recorded decision, writes brief and technical.

#### `draft_email`

Generate an email draft to a stakeholder. Brings context + stakeholder communication profile.

#### `draft_teams_message`

Same, Teams format (shorter, more casual).

#### `summarize_for_handoff`

Summarize a ticket or module to hand off context to another person or explain it in standup.

## 6. Base system prompt (template)

The template is focused on **informing the coding agent as completely as possible**, not on asking it to write well. The main operation that uses it is `compose_context` (when generated narrative is wanted) and the `draft_*` ops. For pure structural `compose_context` there's no LLM call — just data composition.

```
You are WorkBrain, the project brain that loads context into Cursor / Claude Code
so the user can work consulting tickets without manually re-loading context every time.

Your job is NOT to write the client's code — that's done by the coding agent in
the IDE. Your job is to deliver to the agent everything it needs to know about the
ticket, the client, the project, prior decisions, conventions, stakeholders, and
risks, so it writes well-grounded code.

# Active client: {CLIENT_NAME}
# Active project: {PROJECT_NAME}

# Project conventions (firm canon — absolute authority)
{CONVENTIONS_MD}

# Best practices and guidelines
{GUIDELINES_MD}

# Architecture of the relevant module
{ARCHITECTURE_MD}

# Stakeholders in scope
{STAKEHOLDERS_FORMATTED}

# Current focus (ticket, question, module)
{FOCUS_DOCUMENT_FORMATTED}

# Documents linked from focus
{LINKED_DOCS_FORMATTED}

# Related material from corpus (RAG)
{RAG_CHUNKS_FORMATTED}

# Inviolable rules
1. If the active client is {CLIENT_NAME}, do NOT mention or use information from
   other clients, not even as analogies ("in another project we saw X"). Each
   client is an architecturally guaranteed silo.
2. If a recommendation conflicts with the project conventions, explicitly flag the
   conflict and ask the user to confirm before applying. Don't improvise against
   the canon.
3. If retrieved context is insufficient to answer, say so. Do not fabricate
   stakeholders, decisions, or conventions that aren't in the corpus.
4. When citing a ticket or document, use its external_id (e.g. TICKET-1234).
5. For drafts to stakeholders, respect the indicated communication_style.
   Do not improvise tone.
```

The template is rendered in the backend before each LLM call. It's persisted verbatim in `invocations.system_prompt`.

## 7. MCP server — exposed tools

```ts
// MCP tools consumed by Cursor / Claude Code
{
  // Tier 1 — Core
  "ingest_paste":         "Paste raw text (ticket, confluence, teams, email, transcript) and ingest into the active project's corpus.",
  "ingest_url":           "Ingest a public or auth-able URL.",
  "search":               "Semantic search filtered by project.",
  "compose_context":      "Bring composed context (canon + RAG + focus + linked + stakeholders) ready for the agent to work the ticket.",
  "set_active_project":   "Switch the active project of the MCP session.",
  "current_project":      "Return which project is active.",

  // Tier 2 — Continuity
  "record_decision":      "Save a note/ADR about a technical decision.",
  "link_documents":       "Mark explicit relationship between two documents.",
  "list_recent":          "Last N documents in the project.",
  "list_open":            "Tickets in open or in_progress status.",

  // Tier 3 — Auxiliary outputs
  "draft_jira_comment":   "Generate a Jira comment draft.",
  "draft_email":          "Generate an email draft to a stakeholder.",
  "draft_teams_message":  "Generate a Teams message draft.",
  "summarize_for_handoff":"Summarize a ticket or module for handoff or standup."
}
```

## 8. Phased plan

### Phase 1 — Functional skeleton (days 1-4)

**Goal: paste ingestion + search working end-to-end for two pilot projects.**

- [ ] `workbrain` repo on private GitHub
- [ ] Setup Next.js 15 + TypeScript + Drizzle + Postgres on Neon
- [ ] Schema migrated (clients, projects, documents, document_links, chunks, invocations, stakeholders)
- [ ] Seed clients/projects (slugs confirmed by user before this step)
- [ ] Voyage embeddings client (direct HTTP)
- [ ] `POST /api/ingest/paste` endpoint (no LLM classification yet — manual type)
- [ ] `POST /api/search` endpoint
- [ ] Local MCP server (`packages/mcp-server`) with 3 tools: `ingest_paste`, `search`, `set_active_project`
- [ ] MCP server configured in Cursor and in Claude Code (VS Code)
- [ ] Manually seed 5-10 real tickets across two pilot projects + 2-3 Confluence pages + 2-3 Teams threads

**Done when:** the user can paste a ticket in Cursor with `ingest_paste`, then call `search "some technical phrase"` and get relevant chunks filtered by active project.

### Phase 2 — Auto-classification + reranker + compose_context (days 5-9)

- [ ] Paste classifier with Claude Sonnet 4.6 (returns type + frontmatter + auto-detection of referenced external_ids for auto-link)
- [ ] Voyage rerank-2 integrated in search
- [ ] Metadata filters in search (type, externalId, dateRange)
- [ ] `compose_context` endpoint and MCP tool (the flagship operation)
- [ ] `record_decision` and `link_documents` MCP tools
- [ ] Stakeholders table populated by the user for the pilot projects (no defaults from this brief)
- [ ] Conventions, guidelines, and architecture overview per project in `_meta/*.md`

**Done when:** the user calls `compose_context TICKET-1234` in Cursor and the agent receives full canon + ticket + linked docs + related corpus chunks + stakeholders. The agent works on the repo with grounding, with no manual context paste.

### Phase 3 — Multi-provider + auxiliary drafts + Salesforce DX MCP (days 10-14)

- [ ] Multi-provider working (Claude Opus default for reasoning, Sonnet/Haiku for cheap tasks, GPT-5/Gemini as alternates)
- [ ] Full persistence in `invocations` with cost estimation
- [ ] Endpoints and MCP tools for `draft_jira_comment`, `draft_email`, `draft_teams_message`, `summarize_for_handoff`
- [ ] `communication_style` populated by the user for the stakeholders that matter most
- [ ] **Salesforce DX MCP Server** added to the Cursor / Claude Code config (not WorkBrain code, just configuration — but it provides live access to org metadata, complementing WorkBrain perfectly)

**Done when:** the user closes a ticket, the agent generated the code with WorkBrain context, and at the end invokes `draft_jira_comment` to draft the closing comment with appropriate tone. Salesforce DX MCP gives live metadata access without manual paste.

### Phase 4 — Management webapp (days 15-21)

- [ ] Auth with signed cookie (jose)
- [ ] Corpus browser (per-project list, type filters, fast full-text search)
- [ ] Document editor (Tiptap)
- [ ] `document_links` graph visualizer per project
- [ ] Audit trail page with filters by project / operation / date
- [ ] CRUD for stakeholders, conventions, guidelines, architecture overview
- [ ] Persist/ephemeral toggle per project
- [ ] CSV export of invocations per project

### Phase 5 — Live connectors (days 22-30)

- [ ] Atlassian API connector for Jira/Confluence where the user has an API token (weekly sync to local corpus)
- [ ] Outlook / Graph API connector (fetch relevant emails by sender/subject filters)
- [ ] Whisper or Teams native transcription to process meeting videos → transcripts
- [ ] Web fetch for public URLs
- [ ] Background auto-reindex with `waitUntil`

### Phase 6 — Product, not personal tool (days 31+)

- [ ] Auth migration to Clerk (real multi-tenancy: one user = one tenant with N clients inside)
- [ ] Onboarding flow for new users
- [ ] Stripe billing (Individual / Pro / Team tiers)
- [ ] BYOK (bring your own key) for LLM providers
- [ ] Landing page on `workbrain.app`
- [ ] MCP server installation docs
- [ ] CLI for bulk ingestion (useful when a new user wants to upload historical content)
- [ ] Robust ephemeral mode (in-memory corpus, audit still persists but without content)

## 9. Key technical principles, applied from day one

1. `input_type: document` vs `query` in Voyage. Critical, not decorative.
2. Chunking by natural paragraph, not fixed window.
3. Persist the full system prompt on every invocation.
4. RAG is opt-out at runtime — if embed fails, return `[]` and the agent keeps working with canon + focus.
5. Living manifests (firm canon in files, not in code).
6. `waitUntil` for post-save reindex without adding latency.
7. Chunks <20 chars discarded except headings.
8. Interchangeable multi-provider, no parallel broadcast.
9. Three context layers, not single-recovery RAG.
10. Markdown + frontmatter as source of truth.

## 10. Key product decisions

1. **Logical multi-tenancy from day one.** Filter by `projectId` on every query. Cross-client leakage is the worst sin.
2. **Reranker from Phase 2, not as a future improvement.** Cross-client noise justifies it.
3. **MCP server is the primary client.** WorkBrain is MCP-first because the user lives in Cursor / Claude Code, and the system's output (loaded context) has to land in the IDE, not in a separate tab.
4. **Primary output is NOT generated text.** It's **structured context consumed by the coding agent**. Text drafts are tier 3.
5. **Explicit relationship graph (`document_links`).** "Ticket B depends on A" is hard information that shouldn't be left to cosine similarity.
6. **Stakeholders and communication styles exist but are not the core.** They matter for `draft_*` ops, not for product foundation.
7. **Persist/ephemeral per project.** Compliance hook is essential in consulting.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Client forbids persisting their info in external tools | Ephemeral mode per project (`persist: false`). In-memory corpus, wiped at MCP session close. Audit trail persists invocation metadata only, not content. |
| Accidental cross-client leakage in a query | `projectId` always required in `search` and `compose_context`. Tests against this from day one. API validation rejects queries without project. |
| Voyage changes API or raises prices | Embeddings are replaceable; the corpus is markdown, re-embeddable any time with another model. |
| User changes machines | Hosted backend + corpus in private Git = nothing lives only on the laptop. MCP server reinstallable in 5 min. |
| LLM cost explodes | Multi-provider allows degrading to Haiku / Gemini Flash for cheap operations (classification, drafts). Audit trail shows where money is spent. The most expensive operation — `compose_context` — doesn't call LLM in its pure structural form. |
| Corpus grows beyond easy retrieval | HNSW scales well to hundreds of thousands of chunks. If we get there, it's a good problem. |
| Coding agent ignores the context we pass it | Design of `instructions_for_agent` in compose_context: explicit instructions to the agent on how to use the material. Iteration based on real observation of Cursor/Claude Code behavior. |

## 12. Next

1. User reviews this brief and flags what changes or what they question.
2. User confirms client and project slugs to seed before Phase 1.
3. User decides whether the public product name is exactly "WorkBrain" or if WorkBrain is the internal technical name with a different public brand.
4. With that signed off, Phase 1 starts in Cursor.
