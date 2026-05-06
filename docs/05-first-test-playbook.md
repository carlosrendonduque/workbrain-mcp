# First test playbook — WorkBrain end-to-end

Goal: ~30–45 minutes to exercise ingest → search → compose_context end-to-end and decide
which Phase 4 follow-on tasks (4.4 / 4.5 / 4.6 / 4.8 / 4.9) are worth building.

Assumes Phase 1, 2 and Phase 4 MVP-first are merged on `main` and the Neon database has
been seeded (`pnpm db:seed:projects`, `db:meta:sync`, `db:stakeholders:sync`).

---

## 0 · Verify state (1 min)

```bash
cd ~/repos/workbrain/workbrain
git status                         # both repos clean
node --version                     # 18.x is fine on this host
ls .mcp.json .cursor/mcp.json      # both exist (Cursor + Claude Code MCP configs)
```

If both `*.json` files are present, Cursor and Claude Code already know how to talk to
the WorkBrain MCP server.

---

## 1 · Start the webapp (terminal A, leave it running)

```bash
cd ~/repos/workbrain/workbrain/apps/web
pnpm dev
```

Wait for `Ready in Xs`. Open `http://localhost:3000` in the browser → it redirects to
`/login`. Paste your `wbk_…` API key.

Sanity-check the rendered pages:
- **Dashboard** — 4 projects, ~8 documents, ~32 invocations (Phase 1/2 testing data).
- **Corpus → prime-a/acme-finance** — the smoke-test pastes from earlier phases.
- **Audit** — historical API call log.

If all three render, the read path of the system is healthy. Keep this tab open while
you test — every MCP call lands here in real time.

---

## 2 · Pick an IDE client

Choose one and stick with it for this session:

- **Option A — Cursor** (the primary target in the brief).
- **Option B — Claude Code** CLI (faster to demo).

The rest of this document uses **Claude Code** for the examples; Cursor is conceptually
identical (same tools, just invoked from the chat panel).

---

## 3 · Open an MCP session (terminal B)

```bash
cd ~/repos/workbrain/workbrain    # important: this is where .mcp.json lives
claude
```

Inside Claude Code, confirm the MCP server is connected:

```
/mcp
```

You should see a `workbrain` server with seven tools listed:
`set_active_project`, `current_project`, `ingest_paste`, `search`, `record_decision`,
`link_documents`, `compose_context`.

---

## 4 · First end-to-end flow

Drive the agent in natural language. Each step prints a row in `/audit` so you can
inspect what actually happened.

### 4.1 — Activate the project

> Use the `set_active_project` tool to activate `prime-a/acme-finance`.

Expected: `"Active project set to prime-a/acme-finance"`. Webapp `/audit` shows a new row
with `operation: set_active_project`.

### 4.2 — Ingest a ticket without specifying the type (let the classifier decide)

> Ingest this as a new document using `ingest_paste`. Don't pass `type`, let the
> classifier pick it.
>
> ```
> TICKET-9001: Renewal flow breaks on Opportunity stage change
>
> Reported by Maya Chen on 2026-04-30. When an AE flips Stage from "Negotiation"
> to "Closed Won" on an Opportunity that has an associated renewal, the
> RenewalAutoCreate trigger fires twice and creates a duplicate.
>
> Related to TICKET-8870 and the decision adopt-voyage-rerank-2.
> ```

Behind the scenes (~5–10 s):
- Classifier (Sonnet 4.6) infers `type=ticket`, `externalId=TICKET-9001`,
  `references=[TICKET-8870, adopt-voyage-rerank-2]`.
- The `.md` is written to `corpus/prime-a/acme-finance/tickets/TICKET-9001.md` and the
  corpus repo gets a fire-and-forget commit + push.
- Content is chunked, embedded with Voyage, indexed in pgvector.
- Auto-links the two references if those documents already exist in the project.
- An audit row is recorded.

In the webapp:
- `/projects/prime-a/acme-finance` → the `ticket` chip now has the new document, with
  `→2 / ←0` link counts.
- `/audit` → expand the new `ingest_paste` row to inspect `userPrompt` and
  `retrievedChunks`.

### 4.3 — Search

> Use `search` with the query "duplicate renewal" in the active project.

Returns chunks ordered by cosine similarity, second-pass reranked by Voyage rerank-2.
Search itself records an audit row.

### 4.4 — Compose context (the flagship)

> Use `compose_context` with `focusExternalId: "TICKET-9001"`.

You get the full bundle: project canon, focus document with frontmatter, linked
documents grouped by type, RAG chunks (rerank-aware), stakeholders, and a
pre-formatted `instructionsForAgent` block ready to drop into a system prompt.

This is the point of the product. Now drive the agent:

> With that context, propose a plan to fix the trigger duplication bug.

Watch how it reasons against your canon and the linked documents, instead of guessing.

---

## 5 · What to validate mentally

While you test, take notes on:

- **Does the classifier nail the type and external ID?** If not, fall back to
  `type: "ticket"` explicitly on subsequent pastes.
- **Does `compose_context` pull in the right documents?** If you see one missing, force
  the link with `link_documents` and re-run.
- **Is the audit trail enough to debug?** This is what decides Tasks 4.4 (document
  detail) and 4.9 (CSV export).
- **Would a canon editor (4.5) actually save you time?** Equivalent question: when you
  want to update conventions, do you prefer editing
  `corpus/prime-a/acme-finance/_meta/conventions.md` and running `pnpm db:meta:sync`, or
  having a UI to do it?

---

## 6 · After you're done

```bash
# Stop the webapp (Ctrl+C in terminal A) — or leave it if you're still poking around.
# Verify the corpus auto-pushes landed:
cd ~/repos/workbrain/workbrain/corpus && git log --oneline -10
```

---

## Troubleshooting

- **`/mcp` doesn't list `workbrain`** — restart Claude Code / Cursor; the MCP server is
  spawned as a stdio child process at IDE startup.
- **`Invalid API key` from the webapp** — your key may have been rotated. Regenerate
  with `pnpm --filter @workbrain/web db:generate:apikey` (or the script we used in
  Phase 1) and re-login.
- **Corpus commits silently fail** — they're fire-and-forget on purpose. Run
  `cd corpus && git status` to see uncommitted ingests; the next push will catch them
  up. The DB is the source of truth, the corpus repo is the durable copy.
- **Webapp 500 on first load after pulling new code** — wipe `apps/web/.next` and
  restart `pnpm dev`.
