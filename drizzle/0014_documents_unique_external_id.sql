-- One document per external id, per project.
--
-- Ingest now updates an existing document instead of inserting a second one,
-- but application logic is not a constraint. This is the line that makes a
-- duplicate impossible rather than merely unlikely — the failure it prevents
-- was invisible: two documents sharing an id, both feeding search, and
-- compose_context choosing between them non-deterministically.
--
-- Partial, because a document without an external id has no identity to be
-- unique on. Notes and pasted fragments legitimately have none.
--
-- NOTE: this will FAIL on a database that already contains duplicates, which
-- is the correct outcome — they have to be resolved deliberately, not
-- silently discarded. To find them:
--
--   SELECT project_id, external_id, count(*)
--   FROM documents WHERE external_id IS NOT NULL
--   GROUP BY 1, 2 HAVING count(*) > 1;
--
-- Keep the most recently updated of each group and delete the rest; their
-- chunks and links cascade.
--
-- Run with db:migrate:all — dedicated client databases need it too.
CREATE UNIQUE INDEX "documents_project_external_id_key"
  ON "documents" ("project_id", "external_id")
  WHERE "external_id" IS NOT NULL;
