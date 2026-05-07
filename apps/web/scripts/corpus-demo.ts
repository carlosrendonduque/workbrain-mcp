import { config } from "dotenv";
import { buildDocumentPath, writeDocument } from "../src/lib/corpus";
import { commitAndPush, ensureRepo, loadRepoConfigFromEnv } from "../src/lib/git";

config({ path: ".env.local" });

async function main(): Promise<void> {
  const repo = await loadRepoConfigFromEnv();
  if (!repo) {
    throw new Error(
      "Corpus env vars missing. Set WORKBRAIN_CORPUS_PATH and WORKBRAIN_CORPUS_REMOTE in .env.local.",
    );
  }
  await ensureRepo(repo);

  const relativePath = buildDocumentPath({
    clientSlug: "client-a",
    projectSlug: "project-x",
    typeFolder: "tickets",
    fileName: "TICKET-DEMO-0001.md",
  });

  const frontmatter = {
    type: "ticket",
    project: "project-x",
    client: "client-a",
    external_id: "TICKET-DEMO-0001",
    title: "Corpus filesystem layer end-to-end demo",
    status: "in_progress",
    created: new Date().toISOString().slice(0, 10),
    updated: new Date().toISOString().slice(0, 10),
    tags: ["phase-1", "task-1.7", "demo"],
    persist: true,
  };

  const content =
    "# Corpus demo\n\nThis document was written by `apps/web/scripts/corpus-demo.ts`\n" +
    "to verify Task 1.7 acceptance criteria end-to-end:\n\n" +
    "1. The .md file lands at the right path under WORKBRAIN_CORPUS_PATH.\n" +
    "2. A git commit appears in the corpus repo log.\n" +
    "3. The commit is pushed to the configured private remote.\n";

  const written = await writeDocument(relativePath, frontmatter, content, {
    rootPath: repo.rootPath,
  });
  console.log(`wrote ${written.absolutePath}`);

  await commitAndPush(relativePath, `feat(demo): ingest ${frontmatter.external_id}`, repo);
}

main().catch((err: unknown) => {
  console.error("corpus-demo failed:", err);
  process.exit(1);
});
