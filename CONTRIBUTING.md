# Contributing

## What must not enter this repository

This repo is public. Anything committed here is readable by anyone, and
stays readable in the git history long after it is deleted from the
working tree — including in commit messages.

Never commit:

- **Anything about who this work is done for**, or how it is organised.
- **Material taken from real engagements** — tickets, ticket keys, wiki
  pages, chat threads, emails or meeting transcripts, or anything quoting
  them, including as test fixtures or seed data.
- **Organisation names**, or details specific enough to identify one.
- **Design and planning documents.** `docs/` is git-ignored for this
  reason; those live in the private `workbrain` repo.

## Say "tenant", not "client"

In prose, `client` reads as *a client of whoever runs this*, which turns
the data model into an inventory of someone's engagements. Write
**tenant** instead.

The exceptions are literal: the `clients` table and the `db:isolate <client>`
argument are real identifiers, and "MCP client" means Cursor or Claude Code.
