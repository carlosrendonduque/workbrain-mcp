/**
 * Report where every client's corpus lives and whether the app can reach it.
 *
 * This is the check to run before a deploy and the first thing to run when a
 * client's data appears to be missing: a dedicated client whose environment
 * variable is absent fails every request rather than silently reading the
 * shared database, and this says so before a user finds out.
 *
 *   pnpm --filter @workbrain/web db:isolation
 */

import { neon } from "@neondatabase/serverless";
import { schema } from "@workbrain/shared";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import type { WorkbrainDb } from "../src/lib/db";
import { CORPUS_TABLES, countCorpus } from "../src/lib/provisioning";

config({ path: ".env.local" });

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable connection string)";
  }
}

async function main(): Promise<void> {
  const centralUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!centralUrl) {
    throw new Error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL) in apps/web/.env.local");
  }
  const central = drizzle(neon(centralUrl), { schema }) as WorkbrainDb;

  const clients = await central
    .select({
      id: schema.clients.id,
      slug: schema.clients.slug,
      name: schema.clients.name,
      isolationMode: schema.clients.isolationMode,
      corpusDbUrlEnv: schema.clients.corpusDbUrlEnv,
      llmProvider: schema.clients.llmProvider,
      embeddingProvider: schema.clients.embeddingProvider,
      retentionDays: schema.clients.retentionDays,
    })
    .from(schema.clients)
    .orderBy(schema.clients.slug);

  console.log(`\nCentral database: ${hostOf(centralUrl)}`);
  console.log(`${clients.length} client(s)\n`);

  let problems = 0;

  for (const client of clients) {
    const projects = await central
      .select({ id: schema.projects.id, slug: schema.projects.slug })
      .from(schema.projects)
      .where(eq(schema.projects.clientId, client.id));
    const projectIds = projects.map((p) => p.id);

    console.log(`── ${client.slug}  (${client.name})`);
    console.log(`   projects   ${projects.map((p) => p.slug).join(", ") || "(none)"}`);
    console.log(`   ai         llm=${client.llmProvider}  embeddings=${client.embeddingProvider}`);
    console.log(
      `   retention  ${client.retentionDays === null ? "indefinite" : `${client.retentionDays} days`}`,
    );

    if (client.isolationMode !== "dedicated") {
      const counts = await countCorpus(central, projectIds);
      console.log("   storage    shared (central database)");
      console.log(`   corpus     ${CORPUS_TABLES.map((t) => `${t}=${counts[t]}`).join(", ")}`);
      console.log("");
      continue;
    }

    const envName = client.corpusDbUrlEnv;
    if (!envName) {
      problems += 1;
      console.log("   storage    ❌ dedicated, but no corpus_db_url_env is set");
      console.log("              every request for this client fails until it is\n");
      continue;
    }
    const url = process.env[envName];
    if (!url) {
      problems += 1;
      console.log(`   storage    ❌ dedicated via ${envName}, which is NOT set here`);
      console.log("              every request for this client fails until it is\n");
      continue;
    }

    try {
      const dedicated = drizzle(neon(url), { schema }) as WorkbrainDb;
      const counts = await countCorpus(dedicated, projectIds);
      console.log(`   storage    ✅ dedicated — ${hostOf(url)} (via ${envName})`);
      console.log(`   corpus     ${CORPUS_TABLES.map((t) => `${t}=${counts[t]}`).join(", ")}`);

      // Rows left behind in the shared database after a move are not an
      // error, but they are the client's data sitting where the client was
      // told it would not be.
      const stale = await countCorpus(central, projectIds);
      const leftover = CORPUS_TABLES.filter((t) => stale[t] > 0);
      if (leftover.length > 0) {
        problems += 1;
        console.log(
          `   ⚠️  still in the shared database: ${leftover.map((t) => `${t}=${stale[t]}`).join(", ")}`,
        );
        console.log("       run db:isolate ... --purge-source to remove them");
      }
      console.log("");
    } catch (err) {
      problems += 1;
      console.log(`   storage    ❌ dedicated via ${envName}, but the connection failed`);
      console.log(`              ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  if (problems > 0) {
    console.error(`${problems} problem(s) found.`);
    process.exit(1);
  }
  console.log("No problems found.");
}

main().catch((err: unknown) => {
  console.error("isolation-status failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
