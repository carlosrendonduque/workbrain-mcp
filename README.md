# WorkBrain

Multi-client project memory layer for Cursor and Claude Code, consumed via MCP.

> Phase 1 — paste ingestion + semantic search, end-to-end, for two pilot projects.
> See `docs/04-workbrain-design-final.md` for the executable Phase 1 spec.
> See `docs/02-workbrain-implementation-brief.md` for the multi-phase roadmap.

## Stack

- **Runtime:** Node 22 LTS, pnpm 10
- **Backend:** Next.js 15 (App Router) on Vercel
- **Database:** Postgres on Neon (Launch plan), pgvector with HNSW
- **ORM:** Drizzle
- **Embeddings:** Voyage 3 Large (1024 dims)
- **MCP:** Local stdio server in `packages/mcp-server`
- **Lint + format:** Biome
- **Tests:** Vitest

## Layout

```
workbrain/
├── apps/web/                 # Next.js backend (API routes for Phase 1, webapp for Phase 4)
├── packages/
│   ├── shared/               # Drizzle schema, types, frontmatter helpers
│   └── mcp-server/           # Local MCP stdio server
├── docs/                     # Design documents (vision, brief, Phase 1 spec)
└── corpus/                   # Local markdown corpus — separate git repo, gitignored here
```

## Getting started (development)

Requires Node 22 (use `nvm use` to pick up `.nvmrc`).

```bash
pnpm install
pnpm typecheck
pnpm format
```

Detailed setup (Neon, Voyage, MCP integration with Cursor and Claude Code) is
documented progressively as Phase 1 tasks complete.

## Spec deltas vs design doc

Decisions revised against `docs/04-workbrain-design-final.md` Section 2, with
explicit user approval before changing them:

- **Neon plan:** "Pro (USD 19/month)" → **Launch (~USD 15/month)**. Neon
  retired the Pro tier; Launch provides 7-day point-in-time recovery, satisfying
  the brief's non-negotiable PITR requirement.
- **Node version:** "20 LTS" → **22 LTS**. Vercel default is now 22, LTS support
  extends 12 months further, no stack dependency requires 20.
