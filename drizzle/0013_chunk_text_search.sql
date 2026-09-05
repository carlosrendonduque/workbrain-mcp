-- Lexical search alongside the vector one.
--
-- NOTE: like every migration since clients could have databases of their own,
-- this has to reach ALL of them. Run `db:migrate:all`, not `db:migrate` —
-- the central-only command leaves dedicated clients on the old schema, and
-- the failure shows up as "column does not exist" the first time anyone
-- searches that client.
--
-- Cosine similarity is good at "something like this" and bad at "this exact
-- string". Searching for a ticket id, an error message or a class name — the
-- things a consultant actually types — returned near-misses, because a
-- ticket id carries almost no semantic signal.
--
-- Generated and stored rather than computed per query, so it can be indexed.
-- to_tsvector with an explicit configuration is immutable, which is what
-- GENERATED ALWAYS requires.
ALTER TABLE "chunks"
  ADD COLUMN "text_search" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED;
--> statement-breakpoint
CREATE INDEX "chunks_text_search_idx" ON "chunks" USING gin ("text_search");
