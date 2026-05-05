import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  throw new Error("DATABASE_URL_UNPOOLED is not set in apps/web/.env.local");
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  const start = Date.now();
  await migrate(db, { migrationsFolder: "../../drizzle" });
  console.log(`migrations applied in ${Date.now() - start}ms`);

  await pool.end();
}

main().catch((err: unknown) => {
  console.error("migration failed:", err);
  process.exit(1);
});
