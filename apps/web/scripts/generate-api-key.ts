import { createHmac, randomBytes } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { schema } from "@workbrain/shared";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL_UNPOOLED;
const saltHex = process.env.WORKBRAIN_API_KEYS_SALT;
if (!url) {
  throw new Error("DATABASE_URL_UNPOOLED is not set in apps/web/.env.local");
}
if (!saltHex) {
  throw new Error("WORKBRAIN_API_KEYS_SALT is not set in apps/web/.env.local");
}

function ensureArg(value: string | undefined, name: string): string {
  if (!value) {
    console.error(`Missing argument: ${name}`);
    console.error(
      "Usage: pnpm --filter @workbrain/web exec tsx scripts/generate-api-key.ts <email> <label>",
    );
    process.exit(1);
  }
  return value;
}

const email = ensureArg(process.argv[2], "email");
const label = ensureArg(process.argv[3], "label");

const SALT_BUFFER = Buffer.from(saltHex, "hex");

function hashApiKey(rawKey: string): string {
  return createHmac("sha256", SALT_BUFFER).update(rawKey).digest("hex");
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  let userId: string;
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  const existingRow = existing[0];
  if (existingRow) {
    userId = existingRow.id;
    console.log(`reusing user: ${email} (${userId})`);
  } else {
    const inserted = await db
      .insert(schema.users)
      .values({ email })
      .returning({ id: schema.users.id });
    const insertedRow = inserted[0];
    if (!insertedRow) {
      throw new Error("Failed to create user: insert returned no rows");
    }
    userId = insertedRow.id;
    console.log(`created user: ${email} (${userId})`);
  }

  const rawKey = `wbk_${randomBytes(32).toString("hex")}`;
  const keyHash = hashApiKey(rawKey);

  await db.insert(schema.apiKeys).values({ userId, keyHash, label });

  console.log("\nAPI key generated. Copy this NOW — it will not be shown again:\n");
  console.log(`  ${rawKey}\n`);
  console.log(`Label: ${label}`);
  console.log(`User:  ${email} (${userId})\n`);

  await pool.end();
}

main().catch((err: unknown) => {
  console.error("generate-api-key failed:", err);
  process.exit(1);
});
