/**
 * The whole stack, against real infrastructure, ending in the one assertion
 * the product is sold on.
 *
 * Unit tests pin the SQL and the routing without a database; this ingests a
 * document for real — classifier, embeddings, chunking, pgvector — searches
 * it back with different wording, and then asks the same question from
 * another client's project and requires nothing to come back.
 *
 * When that other client sits on a dedicated database, the last step spans
 * two Neon projects, which is the arrangement a single-database test cannot
 * exercise at all.
 *
 * Needs ANTHROPIC_API_KEY, VOYAGE_API_KEY and a seeded database:
 *
 *   pnpm --filter @workbrain/web db:seed:isolation <email>
 *   pnpm --filter @workbrain/web test:e2e <email>
 *
 * Writes one document into zenit-web each run. Costs a fraction of a cent.
 */

import { config } from "dotenv";

config({ path: ".env.local" });

// Imported after dotenv so the connection is built with the file loaded.
const { ingestPaste } = await import("../src/lib/paste");
const { search } = await import("../src/lib/search");
const { db, schema } = await import("../src/lib/db");
const { eq } = await import("drizzle-orm");

const email = process.argv[2] ?? "dev@workbrain.local";
const SOURCE_PROJECT = "zenit-web"; // shared client
const OTHER_PROJECT = "vault"; // a different client entirely

const users = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
const user = users[0];
if (!user) throw new Error(`No user ${email}. Run db:seed:isolation first.`);

const meta = { sessionId: `e2e-${Date.now()}`, clientScope: null };
const stamp = Date.now().toString().slice(-6);

// Deliberately distinctive: if this leaks across clients, it is unmistakable.
const content = `# ZENIT-${stamp} — Rate limiting on the public booking endpoint

Status: In Progress

The public booking endpoint has no rate limit. A single client can open
hundreds of concurrent bookings and starve the worker pool.

Decision: token bucket per API key, 60 requests per minute, burst of 10.
Rejected: per-IP limiting, because most traffic arrives through one gateway.`;

console.log(`\n[1] Ingesting into ${SOURCE_PROJECT} — classify, chunk, embed, index`);
const ingested = await ingestPaste(
  user.id,
  { projectSlug: SOURCE_PROJECT, title: `Rate limiting ZENIT-${stamp}`, content },
  meta,
);
console.log(
  `    document ${ingested.documentId.slice(0, 8)} · ${ingested.chunkCount} chunk(s) · ` +
    `classified as ${String(ingested.frontmatter.type)}`,
);

// Different words on purpose — matching the literal text would prove nothing
// about the embeddings.
const question = "how do we stop one customer from flooding the API?";

console.log(`\n[2] Searching ${SOURCE_PROJECT} with different wording`);
const found = await search(user.id, { query: question, projectSlug: SOURCE_PROJECT }, meta);
console.log(`    ${found.chunks.length} hit(s), reranked: ${found.reranked}`);
for (const c of found.chunks.slice(0, 2)) {
  console.log(
    `    ${(c.rerankScore ?? c.similarity).toFixed(3)}  ${c.text.slice(0, 66).replace(/\n/g, " ")}…`,
  );
}
if (found.chunks.length === 0) {
  console.error("    ❌ ingested content was not retrievable — retrieval is broken");
  process.exit(1);
}

console.log(`\n[3] Same question from ${OTHER_PROJECT} — a different client`);
const leaked = await search(user.id, { query: question, projectSlug: OTHER_PROJECT }, meta);
console.log(`    ${leaked.chunks.length} hit(s)`);
if (leaked.chunks.length > 0) {
  console.error("    ❌ CROSS-CLIENT LEAK. Stop and fix this before anything else.");
  for (const c of leaked.chunks) console.error(`       ${c.documentPath}`);
  process.exit(1);
}
console.log("    ✅ nothing — the isolation held");

console.log("\nAll three passed.");
process.exit(0);
