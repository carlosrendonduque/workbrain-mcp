/**
 * Seed a two-client fixture for exercising the isolation machinery.
 *
 * `db:seed:dev` creates one placeholder client, which is enough to prove
 * ingest works and nothing else. Everything built around tenancy — moving a
 * client to its own database, scoping an API key, detecting a session that
 * touched two clients — needs at least two clients that must not see each
 * other, and it needs them to be distinguishable at a glance when something
 * goes wrong.
 *
 *   leozenit    stays shared. The real low-sensitivity pilot.
 *   testbank    the one to move to a dedicated database with `db:isolate`.
 *
 * Idempotent: rerunning reuses whatever already exists.
 *
 *   pnpm --filter @workbrain/web db:seed:isolation [email] [--docs N]
 *
 * `--docs N` fills each project with N synthetic documents and their chunks.
 * The vectors are made up — nothing here calls an embedding API — because the
 * point is to give `db:isolate` real rows to move, verify and purge. Testing
 * that path should not require credentials or burn credits.
 */

import { Pool } from "@neondatabase/serverless";
import { schema } from "@workbrain/shared";
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  throw new Error("DATABASE_URL_UNPOOLED is not set in apps/web/.env.local");
}

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--")) ?? "dev@workbrain.local";
const docsFlag = args.indexOf("--docs");
const docsPerProject = docsFlag === -1 ? 0 : Number(args[docsFlag + 1] ?? 3);
if (!Number.isFinite(docsPerProject) || docsPerProject < 0) {
  throw new Error("--docs needs a non-negative number");
}

const EMBEDDING_DIMENSIONS = 1024;

/** A deterministic pretend vector. Never sent anywhere; only stored and moved. */
function fakeVector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => Math.sin(seed + i) / 2);
}

const DOMAIN = { slug: "salesforce", name: "Salesforce" };

const CLIENTS = [
  {
    slug: "leozenit",
    name: "ZenIT",
    note: "shared — the low-sensitivity pilot",
    projects: [
      { slug: "zenit-web", name: "ZenIT web" },
      { slug: "zenit-crm", name: "ZenIT CRM" },
    ],
  },
  {
    slug: "testbank",
    name: "Test Bank",
    note: "the one to move to its own database",
    projects: [
      { slug: "vault", name: "Vault" },
      { slug: "ledger", name: "Ledger" },
    ],
  },
];

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  const existingUser = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  let userId = existingUser[0]?.id;
  if (userId) {
    console.log(`user: ${email} (reused)`);
  } else {
    const inserted = await db.insert(schema.users).values({ email }).returning({
      id: schema.users.id,
    });
    userId = inserted[0]?.id;
    if (!userId) throw new Error("failed to insert user");
    console.log(`user: ${email} (created)`);
  }

  // A canon domain so projects can carry the consultant's own cross-project
  // conventions. It stays central even for a dedicated client — those
  // conventions are Carlos's, not the client's.
  const existingDomain = await db
    .select({ id: schema.canonDomains.id })
    .from(schema.canonDomains)
    .where(and(eq(schema.canonDomains.userId, userId), eq(schema.canonDomains.slug, DOMAIN.slug)))
    .limit(1);

  let domainId = existingDomain[0]?.id;
  if (!domainId) {
    const inserted = await db
      .insert(schema.canonDomains)
      .values({ userId, slug: DOMAIN.slug, name: DOMAIN.name })
      .returning({ id: schema.canonDomains.id });
    domainId = inserted[0]?.id;
    console.log(`canon domain: ${DOMAIN.slug} (created)`);
  } else {
    console.log(`canon domain: ${DOMAIN.slug} (reused)`);
  }

  for (const client of CLIENTS) {
    const existingClient = await db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.userId, userId), eq(schema.clients.slug, client.slug)))
      .limit(1);

    let clientId = existingClient[0]?.id;
    if (clientId) {
      console.log(`client: ${client.slug} (reused) — ${client.note}`);
    } else {
      const inserted = await db
        .insert(schema.clients)
        // isolation_mode and the provider columns keep their defaults:
        // shared storage, our own AI accounts. db:isolate is what changes
        // that, and it should be seen doing it.
        .values({ userId, slug: client.slug, name: client.name })
        .returning({ id: schema.clients.id });
      clientId = inserted[0]?.id;
      if (!clientId) throw new Error(`failed to insert client ${client.slug}`);
      console.log(`client: ${client.slug} (created) — ${client.note}`);
    }

    for (const project of client.projects) {
      const existingProject = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(and(eq(schema.projects.clientId, clientId), eq(schema.projects.slug, project.slug)))
        .limit(1);

      if (existingProject[0]) {
        console.log(`  project: ${project.slug} (reused)`);
        continue;
      }
      const inserted = await db
        .insert(schema.projects)
        .values({ clientId, domainId, slug: project.slug, name: project.name })
        .returning({ id: schema.projects.id });
      const projectId = inserted[0]?.id;
      if (!projectId) throw new Error(`failed to insert project ${project.slug}`);
      console.log(`  project: ${project.slug} (created)`);

      if (docsPerProject > 0) {
        for (let d = 1; d <= docsPerProject; d += 1) {
          const externalId = `${client.slug.toUpperCase()}-${1000 + d}`;
          const doc = await db
            .insert(schema.documents)
            .values({
              projectId,
              type: "ticket",
              externalId,
              path: `${client.slug}/${project.slug}/tickets/${externalId}.md`,
              title: `Synthetic ticket ${externalId}`,
              content: `# ${externalId}\n\nSeeded so the isolation tooling has rows to move.`,
              frontmatter: { type: "ticket", external_id: externalId, seeded: true },
            })
            .returning({ id: schema.documents.id });
          const documentId = doc[0]?.id;
          if (!documentId) throw new Error("failed to insert synthetic document");

          await db.insert(schema.chunks).values(
            [0, 1].map((i) => ({
              documentId,
              projectId,
              clientId,
              type: "ticket",
              chunkIndex: i,
              text: `Chunk ${i} of ${externalId}.`,
              tokenCount: 12,
              embedding: fakeVector(d * 10 + i),
              embeddingModel: "seeded-fake",
            })),
          );

          await db.insert(schema.invocations).values({
            userId,
            projectId,
            operation: "search",
            sessionId: `seed-session-${client.slug}`,
            userPrompt: `seeded lookup for ${externalId}`,
            status: "success",
          });
        }
        console.log(`    + ${docsPerProject} document(s), ${docsPerProject * 2} chunk(s)`);
      }
    }
  }

  await pool.end();
  console.log("\nBoth clients are shared for now. Move one with:");
  console.log(
    "  pnpm --filter @workbrain/web db:isolate testbank --url <conn> --env-var WORKBRAIN_DB_TESTCLIENT",
  );
}

main().catch((err: unknown) => {
  console.error("seed-isolation-demo failed:", err);
  process.exit(1);
});
