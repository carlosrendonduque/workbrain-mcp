import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  throw new Error(
    "DATABASE_URL_UNPOOLED is not set. Add it to apps/web/.env.local before running drizzle-kit.",
  );
}

export default defineConfig({
  schema: "../../packages/shared/src/schema.ts",
  out: "../../drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
