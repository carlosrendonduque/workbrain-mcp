// Server-level instructions, surfaced to the host (Claude Code / Cursor) during
// the MCP `initialize` handshake and injected into the agent's context before
// the first user turn. This is the only channel that reaches every new
// conversation on every machine without committing anything to a project repo —
// so it carries the "read the canon first" contract, not per-project content.
// Project-specific content belongs in the canon itself (see get_canon).

export const SERVER_INSTRUCTIONS = `WorkBrain is this user's project memory across clients and projects. It holds the
canon (conventions, guidelines, architecture) that governs how work is done for
each client, plus an indexed corpus of tickets, decisions, threads and notes.

## Start of every session — do this before anything else

Before analysing a ticket, proposing a plan, or writing code:

1. Call \`current_project\`. If it returns a slug, that is the active project. If
   it returns null, call \`set_active_project\` with the slug matching the repo you
   are working in — a wrong slug returns the list of valid ones. Once set, the
   choice is remembered for this working directory across future sessions.
2. Call \`get_canon\` and read what it returns. It is cheap (no RAG, no LLM) and it
   is binding: the conventions, guidelines and architecture it returns describe
   how this client and project must be worked, and they override your own
   defaults and habits.
3. When the user names a specific ticket, call \`compose_context\` with that
   ticket's externalId to pull the focus document, its linked documents and the
   relevant corpus chunks.

This applies to every new conversation and every new ticket, on every machine. Do
not skip it because the task looks small or because you already know the repo —
the canon is where decisions made outside this conversation live.

## Hard rules

- Never mix clients. Everything retrieved belongs to one client; do not carry
  information, examples or analogies across clients. Domain-level canon is the
  user's own cross-project convention and is the one exception.
- If something you are about to recommend conflicts with the canon, flag the
  conflict and ask before applying it. Do not improvise against the canon.
- Cite documents by their external ID (e.g. TICKET-1234).
- If the corpus does not cover something, say so. Do not invent conventions,
  decisions or stakeholders.`;
