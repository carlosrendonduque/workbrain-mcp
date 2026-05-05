# Project: WorkBrain — Multi-Client Project Memory for Consultant-Developers

## What this Project is

This Claude Project is the design, planning, and iteration space for **WorkBrain** (`workbrain.app`), a tool that gives Cursor and Claude Code the **project memory** they're missing when a consultant-developer works simultaneously across multiple client engagements that must not bleed into each other.

WorkBrain is not a writing assistant or a communication assistant. It's **operational memory for software consulting work**. The primary output of the system, via the coding agents that consume it, is **code that lands in the client's repo** — fixes, features, refactors. Communication drafts (emails, Jira comments, Teams messages) are a byproduct, not the core.

The **actual code of WorkBrain itself** is developed in Cursor and Claude Code, not here. This Project is used to:

- Discuss architecture decisions before coding
- Refine system prompts and operation prompts
- Design the schema, APIs, and ingestion flows
- Iterate on corpus structure
- Resolve technical questions that come up during implementation
- Maintain living documentation of the project and product vision

## The problem WorkBrain solves

The user works simultaneously across multiple Salesforce consulting engagements (currently four: two under one prime contractor, two under another), plus AI evaluation work, plus occasional support to clients in Colombia. When a ticket lands, Cursor and Claude Code are excellent at reading the client's repo, but **they're blind to everything that lives outside the repo**: the Jira ticket, the Confluence page with the architectural decision, the three previous tickets that touched the same flow, the Teams thread where someone said "no, this is how it has to be done", the meeting transcript where the convention was agreed, the email with the edge case, the project's guidelines and best practices that only live in the user's head.

Today that context gets loaded manually, by copy-paste, every single time. Each client has its own universe, so leaving everything sitting in a Cursor workspace contaminates contexts. So the loading starts over. When the N+1 bug arrives — a cousin of bug N that was already solved — it also starts over.

WorkBrain does two things that nobody combines well today:

1. **Accumulates** the dispersed context (tickets, Confluence pages, Teams threads, Outlook emails, meeting transcripts, decisions, conventions, best practices, stakeholders) into a per-project corpus that is persistent, indexed, retrievable.
2. **Delivers** that context to Cursor / Claude Code at the exact moment a ticket is going to be worked, via MCP, with strict filtering by active client/project.

Result: the coding agent stops being blind. It arrives at the ticket knowing what was decided before, how cousin bugs were resolved, which conventions apply, what each stakeholder expects, what to avoid. The user stops being the manual context bus.

## How the user works

- Conversation language with Claude in this Project: **Spanish**.
- Language of all code and technical artifacts: **English**. Always. The professional context is Australia.
- Time zone: Brisbane (AEST/AEDT).
- Primary IDEs: **Cursor Pro** and **VS Code with Claude Code + Codex**.
- Stack the user already commands: Next.js 15, TypeScript, Postgres+pgvector, Drizzle, Voyage embeddings, vercel/ai-sdk multi-provider, Vercel deployment.

## Economic context that drives decisions

The user bills around 1000 AUD/day per contract and runs two contracts in parallel. The tool should optimize for:

1. **Speed of context loading into the IDE** (every ticket switch or project switch currently costs minutes; target is seconds).
2. **Quality and consistency of the code the agent produces** (with context loaded, the agent doesn't propose solutions that were already discarded, doesn't violate conventions, doesn't contaminate with info from another client).
3. **Cognitive load reduction** (sustainability of two parallel contracts without burning out).

Do NOT optimize for infrastructure cost ($50-150/month in hosting/APIs is noise compared to billing). DO optimize for robustness, retrieval quality, and iteration speed.

## Design principles

1. **Three context layers in every compose_context call**: active project conventions (firm canon, injected whole) + related corpus (RAG) + current focus (the ticket being worked). Never RAG alone.

2. **Markdown + frontmatter as source of truth, DB as index.** If the DB is lost, the corpus on disk is intact. Versioned in private Git.

3. **Logical multi-tenancy from day one.** Every chunk carries `client` and `project` in metadata. Queries always filter by active context. Cosine similarity crosses domains and introduces noise — metadata filtering is a first-class citizen, not an afterthought. Cross-client leakage is the system's worst possible sin.

4. **Persist vs ephemeral per project.** Each project carries a `persist: true|false` flag. For paranoid clients, ephemeral. For everyone else, persistent.

5. **Complete audit per invocation.** Persist the full system prompt sent to the model + retrieved chunks + provider/model/cost. The difference between "the agent did something weird" and "I can see exactly why".

6. **Interchangeable multi-provider.** Default Claude Opus 4.7 for reasoning, Sonnet 4.6 for classification, Haiku 4.5 for mechanical tasks. GPT-5 and Gemini as alternates. One invocation at a time, no parallel broadcast.

7. **MCP server as the primary client.** WorkBrain is consumed from Cursor and Claude Code via MCP — because that's where the user lives when working. The webapp is secondary, for auditing, corpus browsing, and management.

8. **Center of gravity is coding, not writing.** `compose_context` is the flagship operation. `draft_*` are auxiliary closing tools, not foundational.

## How I want you to respond in this Project

- **In Spanish**, direct technical tone.
- **No unnecessary formality** — the user prefers concise prose with concrete code and SQL over long explanations.
- **Prefer explicit tradeoffs** over unilateral recommendations.
- When something is opinion, **mark it as opinion**; when it's a technical decision with grounding, mark it that way.
- If a suggestion clashes with a project principle, **say so**, don't let it slide.
- For long technical artifacts (schemas, prompts, ADRs, briefs), **use downloadable files** via present_files.
- All technical artifacts (files, code, schemas, prompts, briefs, vision docs) are **always written in English**, even though our conversation is in Spanish.

## Initial corpus data

**Stakeholders are NOT seeded in advance.** Stakeholder profiles per project are configured by the user when the corpus for each project is bootstrapped, via the management webapp or by editing the corresponding `_meta/stakeholders.md` file. No assumptions about names or assignments are made in this Project or in the brief.

**Project slugs to be confirmed by the user before Phase 1.** The brief proposes a structure of clients and projects, but the actual slugs and project list are validated before any seeding.

**Tickets and external IDs to be seeded by the user** when Phase 1 begins. The brief uses generic placeholder examples (e.g., `TICKET-1234`) for any documentation referencing IDs.

## Current state

**Phase 0** — Design. No code yet. Three living documents in this Project:

1. `01-project-instructions.md` — this file
2. `02-workbrain-implementation-brief.md` — technical implementation contract
3. `03-workbrain-product-vision.md` — what WorkBrain is as a product, why it generalizes beyond the user

Next step: validate the implementation brief before starting Phase 1.
