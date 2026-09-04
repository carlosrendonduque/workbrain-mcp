/**
 * Apply migrations to the central database and to every dedicated client
 * database.
 *
 * Once clients can have databases of their own, `db:migrate` on the central
 * one is no longer enough — a schema change that misses a dedicated database
 * breaks that client and nobody else, which is the kind of failure you find
 * out about from the client. Run this instead.
 *
 *   pnpm --filter @workbrain/web db:migrate:all
 */

import { Pool, neon } from "@neondatabase/serverless";
import { schema } from "@workbrain/shared";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

config({ path: ".env.local" });

interface Target {
  label: string;
  url: string;
}

async function applyTo(target: Target): Promise<void> {
  const pool = new Pool({ connectionString: target.url });
  try {
    const start = Date.now();
    await migrate(drizzlePool(pool), { migrationsFolder: "../../drizzle" });
    console.log(`  ✅ ${target.label} — ${Date.now() - start}ms`);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const centralUrl = process.env.DATABASE_URL_UNPOOLED;
  if (!centralUrl) {
    throw new Error("DATABASE_URL_UNPOOLED is not set in apps/web/.env.local");
  }

  const targets: Target[] = [{ label: "central", url: centralUrl }];
  const missing: string[] = [];

  const central = drizzle(neon(centralUrl), { schema });
  const dedicated = await central
    .select({ slug: schema.clients.slug, envVar: schema.clients.corpusDbUrlEnv })
    .from(schema.clients)
    .where(eq(schema.clients.isolationMode, "dedicated"));

  for (const row of dedicated) {
    if (!row.envVar) {
      missing.push(`${row.slug} (no corpus_db_url_env set)`);
      continue;
    }
    const url = process.env[row.envVar];
    if (!url) {
      missing.push(`${row.slug} (${row.envVar} not set in this environment)`);
      continue;
    }
    targets.push({ label: `${row.slug} [${row.envVar}]`, url });
  }

  console.log(`Applying migrations to ${targets.length} database(s):`);
  for (const target of targets) {
    await applyTo(target);
  }

  if (missing.length > 0) {
    // Not a warning to skim past: these clients are live and their schema is
    // now behind the code that queries it.
    console.error(`\n❌ ${missing.length} dedicated client(s) could NOT be migrated:`);
    for (const m of missing) console.error(`  - ${m}`);
    console.error(
      "\nTheir schema is now behind the rest. Set the variables and re-run before deploying.",
    );
    process.exit(1);
  }

  console.log("\nAll databases are up to date.");
}

main().catch((err: unknown) => {
  console.error("migrate-all failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
