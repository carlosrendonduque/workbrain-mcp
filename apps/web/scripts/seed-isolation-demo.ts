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
 *   pnpm --filter @workbrain/web db:seed:isolation [email]
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

const email = process.argv[2] ?? "dev@workbrain.local";

const DOMAIN = { slug: "salesforce", name: "Salesforce" };

const CLIENTS = [
  {
    slug: "leozenit",
    name: "ZenIT",
    note: "shared — the low-sensitivity pilot",
    projects: [{ slug: "zenit-web", name: "ZenIT web" }],
  },
  {
    slug: "testbank",
    name: "Test Bank",
    note: "the one to move to its own database",
    projects: [{ slug: "vault", name: "Vault" }],
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
      if (!inserted[0]) throw new Error(`failed to insert project ${project.slug}`);
      console.log(`  project: ${project.slug} (created)`);
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
