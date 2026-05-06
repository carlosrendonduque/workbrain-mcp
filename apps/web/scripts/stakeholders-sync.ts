import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
import { and, eq, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { schema } from "@workbrain/shared";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

config({ path: ".env.local" });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const dbUrl = requireEnv("DATABASE_URL_UNPOOLED");
const corpusRoot = requireEnv("WORKBRAIN_CORPUS_PATH");

const StakeholderSchema = z.object({
  name: z.string().min(1),
  role: z.string().nullable().optional(),
  communication_style: z.string().nullable().optional(),
});

type StakeholderInput = z.infer<typeof StakeholderSchema>;

interface ProjectRow {
  id: string;
  projectSlug: string;
  clientSlug: string;
}

interface ExistingRow {
  id: string;
  name: string;
  role: string | null;
  communicationStyle: string | null;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

// Walks the source line by line and treats every line that is exactly "---"
// as a fence toggle. Lines between an opening fence and its closing fence
// form a YAML block; anything outside fences is ignored. Multiple blocks per
// file are supported.
function parseStakeholderBlocks(md: string): StakeholderInput[] {
  const lines = md.split("\n");
  const blocks: string[][] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (line.trim() === "---") {
      if (current === null) {
        current = [];
      } else {
        blocks.push(current);
        current = null;
      }
    } else if (current !== null) {
      current.push(line);
    }
  }

  const out: StakeholderInput[] = [];
  for (const block of blocks) {
    const yamlText = block.join("\n").trim();
    if (yamlText.length === 0) continue;
    const parsed: unknown = parseYaml(yamlText);
    out.push(StakeholderSchema.parse(parsed));
  }

  // Dedupe by name (later wins) so the file is forgiving if the user pastes
  // the same person twice.
  const byName = new Map<string, StakeholderInput>();
  for (const s of out) byName.set(s.name, s);
  return Array.from(byName.values());
}

async function readStakeholdersFile(client: string, project: string): Promise<string | null> {
  const path = join(resolve(corpusRoot), client, project, "_meta", "stakeholders.md");
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") return null;
    throw err;
  }
}

interface ProjectSyncOutcome {
  created: number;
  updated: number;
  deleted: number;
  fileEntries: number;
}

async function syncProject(
  db: ReturnType<typeof drizzle<typeof schema>>,
  project: ProjectRow,
  parsed: StakeholderInput[],
): Promise<ProjectSyncOutcome> {
  const existing: ExistingRow[] = await db
    .select({
      id: schema.stakeholders.id,
      name: schema.stakeholders.name,
      role: schema.stakeholders.role,
      communicationStyle: schema.stakeholders.communicationStyle,
    })
    .from(schema.stakeholders)
    .where(eq(schema.stakeholders.projectId, project.id));

  const existingByName = new Map(existing.map((e) => [e.name, e]));

  // DELETE rows whose name is no longer in the file. Empty file = delete all.
  let deleted = 0;
  if (parsed.length === 0) {
    const removed = await db
      .delete(schema.stakeholders)
      .where(eq(schema.stakeholders.projectId, project.id))
      .returning({ id: schema.stakeholders.id });
    deleted = removed.length;
  } else {
    const namesToKeep = parsed.map((s) => s.name);
    const removed = await db
      .delete(schema.stakeholders)
      .where(
        and(
          eq(schema.stakeholders.projectId, project.id),
          notInArray(schema.stakeholders.name, namesToKeep),
        ),
      )
      .returning({ id: schema.stakeholders.id });
    deleted = removed.length;
  }

  // INSERT or UPDATE each parsed entry.
  let created = 0;
  let updated = 0;
  for (const s of parsed) {
    const role = s.role ?? null;
    const style = s.communication_style ?? null;
    const existingRow = existingByName.get(s.name);
    if (existingRow) {
      if (existingRow.role !== role || existingRow.communicationStyle !== style) {
        await db
          .update(schema.stakeholders)
          .set({ role, communicationStyle: style })
          .where(eq(schema.stakeholders.id, existingRow.id));
        updated += 1;
      }
    } else {
      await db.insert(schema.stakeholders).values({
        projectId: project.id,
        name: s.name,
        role,
        communicationStyle: style,
      });
      created += 1;
    }
  }

  return { created, updated, deleted, fileEntries: parsed.length };
}

async function main(): Promise<void> {
  const filter = process.argv[2];
  let filterClient: string | undefined;
  let filterProject: string | undefined;
  if (filter) {
    const parts = filter.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      console.error("Filter must be in form <client-slug>/<project-slug>");
      process.exit(1);
    }
    filterClient = parts[0];
    filterProject = parts[1];
  }

  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool, { schema });

  const all: ProjectRow[] = await db
    .select({
      id: schema.projects.id,
      projectSlug: schema.projects.slug,
      clientSlug: schema.clients.slug,
    })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.projects.clientId, schema.clients.id));

  const projects = filter
    ? all.filter((p) => p.clientSlug === filterClient && p.projectSlug === filterProject)
    : all;

  if (projects.length === 0) {
    console.error(filter ? `No project matched ${filter}` : "No projects found in DB");
    await pool.end();
    process.exit(1);
  }

  console.log(`scanning corpus at ${resolve(corpusRoot)}\n`);

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalDeleted = 0;
  let totalSkipped = 0;

  for (const project of projects) {
    const md = await readStakeholdersFile(project.clientSlug, project.projectSlug);
    if (md === null) {
      console.log(`skipped   ${project.clientSlug}/${project.projectSlug} (no stakeholders.md)`);
      totalSkipped += 1;
      continue;
    }

    let parsed: StakeholderInput[];
    try {
      parsed = parseStakeholderBlocks(md);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `failed    ${project.clientSlug}/${project.projectSlug} parse error: ${message}`,
      );
      continue;
    }

    const outcome = await syncProject(db, project, parsed);
    totalCreated += outcome.created;
    totalUpdated += outcome.updated;
    totalDeleted += outcome.deleted;

    const parts: string[] = [];
    if (outcome.created > 0) parts.push(`${outcome.created} created`);
    if (outcome.updated > 0) parts.push(`${outcome.updated} updated`);
    if (outcome.deleted > 0) parts.push(`${outcome.deleted} deleted`);
    const summary = parts.length === 0 ? "unchanged" : parts.join(", ");
    console.log(
      `${summary.padEnd(36)} ${project.clientSlug}/${project.projectSlug}  (file has ${outcome.fileEntries})`,
    );
  }

  console.log(
    `\n${totalCreated} created, ${totalUpdated} updated, ${totalDeleted} deleted, ${totalSkipped} skipped`,
  );
  await pool.end();
}

main().catch((err: unknown) => {
  console.error("stakeholders-sync failed:", err);
  process.exit(1);
});
