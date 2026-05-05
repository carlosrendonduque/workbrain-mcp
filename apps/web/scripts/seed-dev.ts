import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { schema } from "@workbrain/shared";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  throw new Error("DATABASE_URL_UNPOOLED is not set in apps/web/.env.local");
}

const SEED_EMAIL = "dev@workbrain.local";

interface ProjectSeed {
  slug: string;
  name: string;
}

interface ClientSeed {
  slug: string;
  name: string;
  projects: ProjectSeed[];
}

const SEED_CLIENTS: ClientSeed[] = [
  {
    slug: "client-a",
    name: "Client A (placeholder)",
    projects: [
      { slug: "project-x", name: "Project X (placeholder)" },
      { slug: "project-y", name: "Project Y (placeholder)" },
    ],
  },
];

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  // 1. User — reuse if exists, else create.
  let userId: string;
  const existingUser = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, SEED_EMAIL))
    .limit(1);
  const existingUserRow = existingUser[0];
  if (existingUserRow) {
    userId = existingUserRow.id;
    console.log(`reusing user: ${SEED_EMAIL} (${userId})`);
  } else {
    const inserted = await db
      .insert(schema.users)
      .values({ email: SEED_EMAIL })
      .returning({ id: schema.users.id });
    const insertedRow = inserted[0];
    if (!insertedRow) throw new Error("failed to insert user");
    userId = insertedRow.id;
    console.log(`created user: ${SEED_EMAIL} (${userId})`);
  }

  // 2. Clients + projects, idempotently.
  for (const client of SEED_CLIENTS) {
    let clientId: string;
    const existingClient = await db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.userId, userId), eq(schema.clients.slug, client.slug)))
      .limit(1);
    const existingClientRow = existingClient[0];
    if (existingClientRow) {
      clientId = existingClientRow.id;
      console.log(`reusing client: ${client.slug} (${clientId})`);
    } else {
      const inserted = await db
        .insert(schema.clients)
        .values({ userId, slug: client.slug, name: client.name })
        .returning({ id: schema.clients.id });
      const insertedRow = inserted[0];
      if (!insertedRow) throw new Error(`failed to insert client ${client.slug}`);
      clientId = insertedRow.id;
      console.log(`created client: ${client.slug} (${clientId})`);
    }

    for (const project of client.projects) {
      const existingProject = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(and(eq(schema.projects.clientId, clientId), eq(schema.projects.slug, project.slug)))
        .limit(1);
      const existingProjectRow = existingProject[0];
      if (existingProjectRow) {
        console.log(`  reusing project: ${project.slug} (${existingProjectRow.id})`);
      } else {
        const inserted = await db
          .insert(schema.projects)
          .values({ clientId, slug: project.slug, name: project.name })
          .returning({ id: schema.projects.id });
        const insertedRow = inserted[0];
        if (!insertedRow) throw new Error(`failed to insert project ${project.slug}`);
        console.log(`  created project: ${project.slug} (${insertedRow.id})`);
      }
    }
  }

  await pool.end();
}

main().catch((err: unknown) => {
  console.error("seed-dev failed:", err);
  process.exit(1);
});
