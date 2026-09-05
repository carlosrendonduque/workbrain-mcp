/**
 * Destroy a client's corpus at the end of an engagement, and issue the
 * certificate that says so.
 *
 *   pnpm --filter @workbrain/web db:destroy <client-slug> [email]
 *
 * Shows what would be removed and stops. Nothing is deleted until the slug is
 * typed a second time:
 *
 *   pnpm --filter @workbrain/web db:destroy <slug> [email] --confirm <slug>
 *
 * Typing it twice is the guard. This is the one irreversible operation in the
 * system, and a mistyped argument must not be enough to run it.
 */

import { config } from "dotenv";

config({ path: ".env.local" });

const { previewDestruction, destroyClientCorpus } = await import("../src/lib/destruction");
const { CORPUS_TABLES } = await import("../src/lib/provisioning");
const { db, schema } = await import("../src/lib/db");
const { eq } = await import("drizzle-orm");
const { writeFileSync } = await import("node:fs");

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const clientSlug = positional[0];
const email = positional[1] ?? "dev@workbrain.local";
const confirmIndex = args.indexOf("--confirm");
const confirmed = confirmIndex === -1 ? null : args[confirmIndex + 1];
const outIndex = args.indexOf("--out");
const outFile = outIndex === -1 ? null : args[outIndex + 1];

if (!clientSlug) {
  throw new Error("Usage: db:destroy <client-slug> [email] [--confirm <client-slug>] [--out FILE]");
}

const users = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
const user = users[0];
if (!user) throw new Error(`No user ${email}`);

const preview = await previewDestruction(user.id, clientSlug);
const total = CORPUS_TABLES.reduce((n, t) => n + preview.counts[t], 0);

console.log(`\nClient   ${preview.clientName} (${preview.clientSlug})`);
console.log(`Projects ${preview.projectSlugs.join(", ") || "(none)"}`);
console.log(`Held in  ${preview.storage}`);
console.log("\nWould remove:");
for (const t of CORPUS_TABLES) {
  if (preview.counts[t] > 0) console.log(`  ${t.padEnd(18)} ${preview.counts[t]}`);
}
if (total === 0) console.log("  (nothing — the corpus is already empty)");

if (confirmed !== clientSlug) {
  console.log(
    [
      "",
      "Nothing was deleted.",
      "",
      "This cannot be undone. To go ahead, type the slug again:",
      "",
      `  pnpm --filter @workbrain/web db:destroy ${clientSlug} ${email} --confirm ${clientSlug}`,
    ].join("\n"),
  );
  process.exit(0);
}

console.log("\nDestroying…");
const cert = await destroyClientCorpus(user.id, clientSlug);
console.log("Done. Certificate recorded in the central database.\n");
console.log(cert.markdown);

if (outFile) {
  writeFileSync(outFile, cert.markdown, "utf8");
  console.log(`\nAlso written to ${outFile}`);
}
process.exit(0);
