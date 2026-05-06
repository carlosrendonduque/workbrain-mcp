import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { schema } from "@workbrain/shared";

config({ path: ".env.local" });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const dbUrl = requireEnv("DATABASE_URL_UNPOOLED");
const corpusRoot = requireEnv("WORKBRAIN_CORPUS_PATH");

const META_FIELDS = ["conventions", "guidelines", "architecture"] as const;
type MetaField = (typeof META_FIELDS)[number];

interface ProjectRow {
  id: string;
  projectSlug: string;
  clientSlug: string;
  conventions: string | null;
  guidelines: string | null;
  architecture: string | null;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

async function readMetaFile(
  client: string,
  project: string,
  field: MetaField,
): Promise<string | null> {
  const path = join(resolve(corpusRoot), client, project, "_meta", `${field}.md`);
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") return null;
    throw err;
  }
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
      conventions: schema.projects.conventions,
      guidelines: schema.projects.guidelines,
      architecture: schema.projects.architecture,
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

  let totalUpdated = 0;
  let totalUnchanged = 0;
  let totalSkipped = 0;

  for (const project of projects) {
    const updates: Partial<Record<MetaField, string | null>> = {};
    let changedFields = 0;
    let onDiskCount = 0;

    for (const field of META_FIELDS) {
      const content = await readMetaFile(project.clientSlug, project.projectSlug, field);
      if (content !== null) onDiskCount += 1;
      if (content !== project[field]) {
        updates[field] = content;
        changedFields += 1;
      }
    }

    if (changedFields > 0) {
      await db.update(schema.projects).set(updates).where(eq(schema.projects.id, project.id));
      const summary = META_FIELDS.filter((f) => f in updates)
        .map((f) => (updates[f] === null ? `${f}(removed)` : f))
        .join(", ");
      console.log(`updated   ${project.clientSlug}/${project.projectSlug}: ${summary}`);
      totalUpdated += 1;
    } else if (onDiskCount === 0) {
      console.log(
        `skipped   ${project.clientSlug}/${project.projectSlug} (no _meta files on disk)`,
      );
      totalSkipped += 1;
    } else {
      console.log(`unchanged ${project.clientSlug}/${project.projectSlug}`);
      totalUnchanged += 1;
    }
  }

  console.log(`\n${totalUpdated} updated, ${totalUnchanged} unchanged, ${totalSkipped} skipped`);
  await pool.end();
}

main().catch((err: unknown) => {
  console.error("meta-sync failed:", err);
  process.exit(1);
});
