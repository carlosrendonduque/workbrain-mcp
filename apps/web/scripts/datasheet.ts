/**
 * Print the data sheet for one client.
 *
 * The page to hand to whoever asks where their data is. Generated from the
 * live system every time, so it cannot quietly drift out of date the way a
 * hand-written security document does.
 *
 *   pnpm --filter @workbrain/web db:datasheet <client-slug> [email] [--out FILE]
 */

import { config } from "dotenv";

config({ path: ".env.local" });

const { buildDatasheet } = await import("../src/lib/datasheet");
const { db, schema } = await import("../src/lib/db");
const { eq } = await import("drizzle-orm");
const { writeFileSync } = await import("node:fs");

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const clientSlug = positional[0];
const email = positional[1] ?? "dev@workbrain.local";
const outIndex = args.indexOf("--out");
const outFile = outIndex === -1 ? null : args[outIndex + 1];

if (!clientSlug) {
  throw new Error("Usage: db:datasheet <client-slug> [email] [--out FILE]");
}

const users = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
const user = users[0];
if (!user) throw new Error(`No user ${email}`);

const sheet = await buildDatasheet(user.id, clientSlug);

if (outFile) {
  writeFileSync(outFile, sheet.markdown, "utf8");
  console.log(`Written to ${outFile}`);
} else {
  console.log(sheet.markdown);
}
process.exit(0);
