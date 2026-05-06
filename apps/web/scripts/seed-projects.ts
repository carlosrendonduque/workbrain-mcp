import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { schema } from "@workbrain/shared";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  throw new Error("DATABASE_URL_UNPOOLED is not set in apps/web/.env.local");
}

const SEED_EMAIL = "dev@workbrain.local";
const PLACEHOLDER_CLIENT_SLUG = "client-a";
const PLACEHOLDER_PROJECT_SLUGS = ["project-x", "project-y"] as const;

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const rl = createInterface({ input: stdin, output: stdout });

async function ask(question: string): Promise<string> {
  return (await rl.question(question)).trim();
}

async function askRequired(question: string): Promise<string> {
  while (true) {
    const value = await ask(question);
    if (value.length > 0) return value;
    console.log("  please enter a non-empty value.");
  }
}

async function askSlug(question: string, taken: ReadonlySet<string>): Promise<string> {
  while (true) {
    const value = (await askRequired(question)).toLowerCase();
    if (!SLUG_PATTERN.test(value)) {
      console.log(
        "  invalid slug. Use lowercase letters, digits and dashes (no leading/trailing dash).",
      );
      continue;
    }
    if (taken.has(value)) {
      console.log(`  slug already chosen in this run: ${value}`);
      continue;
    }
    return value;
  }
}

async function askYesNo(question: string, defaultYes: boolean): Promise<boolean> {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  while (true) {
    const raw = (await ask(`${question} ${suffix} `)).toLowerCase();
    if (raw === "") return defaultYes;
    if (raw === "y" || raw === "yes") return true;
    if (raw === "n" || raw === "no") return false;
    console.log("  answer with y or n.");
  }
}

async function askChoice<T extends string>(
  question: string,
  choices: readonly T[],
  defaultChoice: T,
): Promise<T> {
  while (true) {
    const raw = (
      await ask(`${question} (${choices.join("/")}) [default: ${defaultChoice}] `)
    ).toLowerCase();
    if (raw === "") return defaultChoice;
    const found = choices.find((c) => c === raw);
    if (found) return found;
    console.log(`  pick one of: ${choices.join(", ")}`);
  }
}

interface ProjectInput {
  slug: string;
  name: string;
}

interface ClientInput {
  slug: string;
  name: string;
  projects: ProjectInput[];
}

async function collectClients(): Promise<ClientInput[]> {
  const clients: ClientInput[] = [];
  const clientSlugs = new Set<string>();

  console.log(
    "\nLet's seed your real clients and projects. You can re-run this script later to add more.\n",
  );

  while (true) {
    const slug = await askSlug(`Client #${clients.length + 1} slug: `, clientSlugs);
    const name = await askRequired(`Client #${clients.length + 1} display name: `);
    clientSlugs.add(slug);

    const projects: ProjectInput[] = [];
    const projectSlugs = new Set<string>();
    while (true) {
      const pSlug = await askSlug(
        `  Project #${projects.length + 1} slug (under ${slug}): `,
        projectSlugs,
      );
      const pName = await askRequired(`  Project #${projects.length + 1} display name: `);
      projects.push({ slug: pSlug, name: pName });
      projectSlugs.add(pSlug);

      const more = await askYesNo("  Add another project under this client?", false);
      if (!more) break;
    }

    clients.push({ slug, name, projects });

    const moreClients = await askYesNo("Add another client?", false);
    if (!moreClients) break;
  }

  return clients;
}

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

async function ensureUser(db: DrizzleDb): Promise<string> {
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, SEED_EMAIL))
    .limit(1);
  const existingRow = existing[0];
  if (existingRow) return existingRow.id;

  const inserted = await db
    .insert(schema.users)
    .values({ email: SEED_EMAIL })
    .returning({ id: schema.users.id });
  const insertedRow = inserted[0];
  if (!insertedRow) throw new Error("failed to insert user");
  return insertedRow.id;
}

async function upsertClient(db: DrizzleDb, userId: string, c: ClientInput): Promise<string> {
  const existing = await db
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .where(and(eq(schema.clients.userId, userId), eq(schema.clients.slug, c.slug)))
    .limit(1);
  const existingRow = existing[0];
  if (existingRow) {
    if (existingRow.name !== c.name) {
      await db
        .update(schema.clients)
        .set({ name: c.name })
        .where(eq(schema.clients.id, existingRow.id));
      console.log(`  updated client name: ${c.slug}`);
    } else {
      console.log(`  client unchanged: ${c.slug}`);
    }
    return existingRow.id;
  }
  const inserted = await db
    .insert(schema.clients)
    .values({ userId, slug: c.slug, name: c.name })
    .returning({ id: schema.clients.id });
  const insertedRow = inserted[0];
  if (!insertedRow) throw new Error(`failed to insert client ${c.slug}`);
  console.log(`  created client: ${c.slug}`);
  return insertedRow.id;
}

async function upsertProject(db: DrizzleDb, clientId: string, p: ProjectInput): Promise<void> {
  const existing = await db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(and(eq(schema.projects.clientId, clientId), eq(schema.projects.slug, p.slug)))
    .limit(1);
  const existingRow = existing[0];
  if (existingRow) {
    if (existingRow.name !== p.name) {
      await db
        .update(schema.projects)
        .set({ name: p.name })
        .where(eq(schema.projects.id, existingRow.id));
      console.log(`    updated project name: ${p.slug}`);
    } else {
      console.log(`    project unchanged: ${p.slug}`);
    }
    return;
  }
  await db.insert(schema.projects).values({ clientId, slug: p.slug, name: p.name });
  console.log(`    created project: ${p.slug}`);
}

async function handlePlaceholders(db: DrizzleDb, userId: string): Promise<void> {
  const placeholderClient = await db
    .select({ id: schema.clients.id, name: schema.clients.name })
    .from(schema.clients)
    .where(and(eq(schema.clients.userId, userId), eq(schema.clients.slug, PLACEHOLDER_CLIENT_SLUG)))
    .limit(1);
  const clientRow = placeholderClient[0];
  if (!clientRow) {
    return;
  }

  const placeholderProjects = await db
    .select({ id: schema.projects.id, slug: schema.projects.slug, name: schema.projects.name })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.clientId, clientRow.id),
        inArray(schema.projects.slug, [...PLACEHOLDER_PROJECT_SLUGS]),
      ),
    );

  console.log("\nPlaceholder data found from db:seed:dev:");
  console.log(`  client ${PLACEHOLDER_CLIENT_SLUG} (${clientRow.name})`);
  for (const p of placeholderProjects) {
    console.log(`    project ${p.slug} (${p.name})`);
  }

  const action = await askChoice(
    "What should I do with the placeholders?",
    ["archive", "keep"] as const,
    "archive",
  );

  if (action === "keep") {
    console.log("  placeholders kept as-is.");
    return;
  }

  // archive: prefix names with [archived] (idempotent — no double-prefix)
  if (!clientRow.name.startsWith("[archived]")) {
    await db
      .update(schema.clients)
      .set({ name: `[archived] ${clientRow.name}` })
      .where(eq(schema.clients.id, clientRow.id));
    console.log(`  archived client: ${PLACEHOLDER_CLIENT_SLUG}`);
  }
  for (const p of placeholderProjects) {
    if (!p.name.startsWith("[archived]")) {
      await db
        .update(schema.projects)
        .set({ name: `[archived] ${p.name}` })
        .where(eq(schema.projects.id, p.id));
      console.log(`  archived project: ${p.slug}`);
    }
  }
}

async function main(): Promise<void> {
  console.log("WorkBrain — interactive project seeder\n");
  console.log("This will add new clients and projects under your user.");
  console.log("It is idempotent: re-running won't duplicate rows; existing names get refreshed.\n");

  const clients = await collectClients();

  console.log("\nReview before applying:");
  for (const c of clients) {
    console.log(`  ${c.slug}  (${c.name})`);
    for (const p of c.projects) {
      console.log(`    ${p.slug}  (${p.name})`);
    }
  }
  const confirm = await askYesNo("\nApply these changes?", true);
  if (!confirm) {
    console.log("aborted, no changes written.");
    rl.close();
    return;
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  try {
    const userId = await ensureUser(db);
    console.log("");
    for (const c of clients) {
      const clientId = await upsertClient(db, userId, c);
      for (const p of c.projects) {
        await upsertProject(db, clientId, p);
      }
    }

    await handlePlaceholders(db, userId);

    console.log("\ndone.");
  } finally {
    await pool.end();
    rl.close();
  }
}

main().catch((err: unknown) => {
  console.error("seed-projects failed:", err);
  rl.close();
  process.exit(1);
});
