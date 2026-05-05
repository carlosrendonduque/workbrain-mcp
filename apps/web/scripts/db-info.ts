import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  throw new Error("DATABASE_URL_UNPOOLED is not set in apps/web/.env.local");
}

interface TableRow {
  table_name: string;
}
interface ExtRow {
  extname: string;
  extversion: string;
}
interface IndexRow {
  indexname: string;
  indexdef: string;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: url });

  const ext = await pool.query<ExtRow>(
    "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'",
  );
  console.log("\n=== pgvector extension ===");
  if (ext.rows.length === 0) {
    console.log("  ❌ vector extension NOT installed");
  } else {
    for (const row of ext.rows) {
      console.log(`  ✅ ${row.extname} v${row.extversion}`);
    }
  }

  const tables = await pool.query<TableRow>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
  );
  console.log(`\n=== tables in public (${tables.rows.length}) ===`);
  for (const row of tables.rows) {
    console.log(`  - ${row.table_name}`);
  }

  const indexes = await pool.query<IndexRow>(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'chunks' ORDER BY indexname`,
  );
  console.log(`\n=== indexes on chunks (${indexes.rows.length}) ===`);
  for (const row of indexes.rows) {
    const isHnsw = row.indexdef.toLowerCase().includes("using hnsw");
    const marker = isHnsw ? "🟢 HNSW" : "       ";
    console.log(`  ${marker}  ${row.indexname}`);
    console.log(`           ${row.indexdef}`);
  }

  await pool.end();
}

main().catch((err: unknown) => {
  console.error("db-info failed:", err);
  process.exit(1);
});
