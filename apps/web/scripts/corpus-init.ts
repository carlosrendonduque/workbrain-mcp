import { config } from "dotenv";
import { ensureRepo, loadRepoConfigFromEnv } from "../src/lib/git";

config({ path: ".env.local" });

async function main(): Promise<void> {
  const repo = await loadRepoConfigFromEnv();
  console.log(`initializing corpus at ${repo.rootPath}`);
  console.log(`remote: ${repo.remoteUrl}`);
  console.log(`branch: ${repo.branch}`);

  await ensureRepo(repo);

  console.log("\ncorpus is ready.");
  console.log("If the remote is empty, the first commit + push will create the branch on GitHub.");
}

main().catch((err: unknown) => {
  console.error("corpus-init failed:", err);
  process.exit(1);
});
