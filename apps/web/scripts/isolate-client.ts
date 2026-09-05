/**
 * Move one client from the shared database into a database of its own.
 *
 * The order is deliberate: everything is copied and verified BEFORE the
 * client row flips to `dedicated`. Until it flips, the app still reads and
 * writes the shared database, so stopping half way — or killing this script —
 * leaves a working system and a harmless half-filled database.
 *
 *   pnpm --filter @workbrain/web db:isolate <client-slug> [options]
 *
 *   --url <conn>      Use a database you created yourself instead of asking
 *                     Neon to create one (needs NEON_API_KEY otherwise).
 *   --region <id>     Neon region when creating, e.g. aws-ap-southeast-2.
 *   --env-var <NAME>  Override the suggested environment variable name.
 *   --apply           Flip the client to dedicated once the copy verifies.
 *                     Without this the script stops after verifying and
 *                     changes nothing.
 *   --purge-source    After flipping, delete the copied rows from the shared
 *                     database. Irreversible; run it once you are satisfied.
 */

import { Pool, neon } from "@neondatabase/serverless";
import { schema } from "@workbrain/shared";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import type { WorkbrainDb } from "../src/lib/db";
import {
  CORPUS_TABLES,
  countCorpus,
  countMismatches,
  copyCorpus,
  createNeonProject,
  envVarNameForClient,
  markDedicated,
  purgeCorpus,
  readRegistry,
  replicateRegistry,
} from "../src/lib/provisioning";

config({ path: ".env.local" });

interface Args {
  clientSlug: string;
  url?: string;
  region?: string;
  envVar?: string;
  apply: boolean;
  purgeSource: boolean;
}

function parseArgs(argv: string[]): Args {
  const [clientSlug, ...rest] = argv;
  if (!clientSlug || clientSlug.startsWith("--")) {
    throw new Error(
      "Usage: db:isolate <client-slug> [--url <conn>] [--region <id>] [--env-var <NAME>] [--apply] [--purge-source]",
    );
  }
  const args: Args = { clientSlug, apply: false, purgeSource: false };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === "--apply") args.apply = true;
    else if (flag === "--purge-source") args.purgeSource = true;
    else if (flag === "--url") args.url = rest[++i];
    else if (flag === "--region") args.region = rest[++i];
    else if (flag === "--env-var") args.envVar = rest[++i];
    else throw new Error(`Unknown flag: ${flag}`);
  }
  return args;
}

function step(n: number, text: string): void {
  console.log(`\n[${n}] ${text}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const centralUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!centralUrl) {
    throw new Error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL) in apps/web/.env.local");
  }
  const central = drizzle(neon(centralUrl), { schema }) as WorkbrainDb;

  step(1, `Looking up client '${args.clientSlug}'`);
  const clients = await central
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.slug, args.clientSlug))
    .limit(1);
  const client = clients[0];
  if (!client) throw new Error(`No client with slug '${args.clientSlug}'`);
  if (client.isolationMode === "dedicated") {
    console.log(
      `    Already dedicated (reads ${client.corpusDbUrlEnv}). Nothing to do.\n` +
        "    To re-verify, point --url at its database and run without --apply.",
    );
    if (!args.url) return;
  }

  const registry = await readRegistry(central, client.id);
  const projectIds = registry.projects.map((p) => p.id);
  console.log(`    ${client.name} — ${projectIds.length} project(s)`);

  const sourceCounts = await countCorpus(central, projectIds);
  console.log(
    `    In the shared database: ${CORPUS_TABLES.map((t) => `${t}=${sourceCounts[t]}`).join(", ")}`,
  );

  const envVarName = args.envVar ?? envVarNameForClient(client.slug);

  step(2, "Obtaining the dedicated database");
  let targetUrl: string;
  if (args.url) {
    targetUrl = args.url;
    console.log("    Using the connection string passed with --url");
  } else {
    const apiKey = process.env.NEON_API_KEY;
    if (!apiKey) {
      throw new Error(
        "No --url given and NEON_API_KEY is not set.\n" +
          "  Either create a Neon project by hand and pass --url <connection string>,\n" +
          "  or add NEON_API_KEY to apps/web/.env.local so this script can create one.",
      );
    }
    const projectName = `workbrain-${client.slug}`;
    console.log(`    Asking Neon for a new project '${projectName}'...`);
    const created = await createNeonProject({
      apiKey,
      name: projectName,
      regionId: args.region,
    });
    targetUrl = created.connectionUri;
    console.log(`    Created Neon project ${created.projectId}`);
  }

  const target = drizzle(neon(targetUrl), { schema }) as WorkbrainDb;

  step(3, "Applying migrations to the dedicated database");
  const pool = new Pool({ connectionString: targetUrl });
  try {
    await migrate(drizzlePool(pool), { migrationsFolder: "../../drizzle" });
    console.log("    Schema is up to date");
  } finally {
    await pool.end();
  }

  step(4, "Replicating the registry rows the corpus points at");
  await replicateRegistry(target, registry);
  console.log(
    `    1 user + 1 client + ${registry.projects.length} project(s). Nothing reads these; they exist so the foreign keys resolve.`,
  );

  step(5, "Copying the corpus");
  await copyCorpus({
    source: central,
    target,
    projectIds,
    onProgress: (table, n) => console.log(`    ${table}: ${n}`),
  });

  step(6, "Verifying");
  const targetCounts = await countCorpus(target, projectIds);
  const mismatches = countMismatches(sourceCounts, targetCounts);
  if (mismatches.length > 0) {
    console.error("    ❌ Row counts do not match. Nothing has been changed.");
    for (const m of mismatches) {
      console.error(`       ${m.table}: shared=${m.source} dedicated=${m.target}`);
    }
    console.error("    Re-run the script — the copy is idempotent — or investigate first.");
    process.exit(1);
  }
  console.log(
    `    ✅ Every table matches (${CORPUS_TABLES.map((t) => targetCounts[t]).join("/")})`,
  );

  if (!args.apply) {
    console.log(
      [
        "",
        "Copy verified. The client is still SHARED — nothing was switched over.",
        "",
        "To finish:",
        `  1. Add this to your environment (and to Vercel, for production):`,
        "",
        `       ${envVarName}="${targetUrl}"`,
        "",
        `  2. Re-run with --apply:`,
        "",
        `       pnpm --filter @workbrain/web db:isolate ${client.slug} --url "<same url>" --apply`,
        "",
        "  3. Once you have confirmed the app reads the new database, run again",
        "     with --purge-source to remove the rows from the shared database.",
      ].join("\n"),
    );
    return;
  }

  step(7, "Switching the client over");
  const present = process.env[envVarName];
  if (!present) {
    console.error(
      `    ❌ ${envVarName} is not set in this environment.\n` +
        "    Flipping the client now would make the app fail on every request for it.\n" +
        `    Set it first:  ${envVarName}="<connection string>"`,
    );
    process.exit(1);
  }
  if (present !== targetUrl) {
    console.error(
      `    ❌ ${envVarName} is set, but to a different connection string than the one just populated.\n` +
        "    Refusing to switch — point it at the database this run copied into.",
    );
    process.exit(1);
  }
  await markDedicated(central, client.id, envVarName);
  console.log(`    ✅ '${client.slug}' now reads ${envVarName}`);
  console.log(
    "    Remember to set the same variable in Vercel, or production will fail for this client.",
  );

  if (args.purgeSource) {
    step(8, "Removing the copied rows from the shared database");
    const removed = await purgeCorpus(central, projectIds);
    console.log(`    Deleted ${CORPUS_TABLES.map((t) => `${t}=${removed[t]}`).join(", ")}`);
    console.log("    This client's corpus now exists only in its own database.");
  } else {
    console.log(
      "\nThe rows are still in the shared database too. Once you have confirmed the app\n" +
        "works against the new one, run again with --purge-source to remove them.",
    );
  }
}

main().catch((err: unknown) => {
  console.error("\nisolate-client failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
