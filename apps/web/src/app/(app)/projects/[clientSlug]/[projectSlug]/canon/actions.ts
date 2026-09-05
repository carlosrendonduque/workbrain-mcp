"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { ProjectError, setProjectDomain } from "@/lib/projects";
import { requireSession } from "@/lib/webapp-auth";

export type CanonActionState =
  | { status: "idle" }
  | { status: "success"; message: string; updatedAt: string }
  | { status: "error"; message: string; code?: string };

export type DomainAssignState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string; code?: string };

function readField(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function saveCanonAction(
  _prev: CanonActionState,
  formData: FormData,
): Promise<CanonActionState> {
  const session = await requireSession();

  const clientSlug = formData.get("clientSlug");
  const projectSlug = formData.get("projectSlug");
  if (typeof clientSlug !== "string" || typeof projectSlug !== "string") {
    return { status: "error", message: "Missing project context.", code: "missing_route" };
  }

  const ownership = await db
    .select({ projectId: schema.projects.id })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(
      and(
        eq(schema.clients.userId, session.userId),
        eq(schema.clients.slug, clientSlug),
        eq(schema.projects.slug, projectSlug),
      ),
    )
    .limit(1);

  const owned = ownership[0];
  if (!owned) {
    return { status: "error", message: "Project not found.", code: "project_not_found" };
  }

  try {
    await db
      .update(schema.projects)
      .set({
        conventions: readField(formData, "conventions"),
        guidelines: readField(formData, "guidelines"),
        architecture: readField(formData, "architecture"),
      })
      .where(eq(schema.projects.id, owned.projectId));

    revalidatePath(`/projects/${clientSlug}/${projectSlug}`);
    revalidatePath(`/projects/${clientSlug}/${projectSlug}/canon`);

    return {
      status: "success",
      message:
        "Canon saved. Disk version may be stale — run `pnpm db:meta:sync` if you also edit `_meta/*.md` on disk.",
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function assignProjectDomainAction(
  _prev: DomainAssignState,
  formData: FormData,
): Promise<DomainAssignState> {
  const session = await requireSession();

  const clientSlug = formData.get("clientSlug");
  const projectSlug = formData.get("projectSlug");
  const domainId = formData.get("domainId");
  if (
    typeof clientSlug !== "string" ||
    typeof projectSlug !== "string" ||
    typeof domainId !== "string" ||
    domainId.length === 0
  ) {
    return { status: "error", message: "Missing fields.", code: "missing_fields" };
  }

  const ownership = await db
    .select({ projectId: schema.projects.id })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(
      and(
        eq(schema.clients.userId, session.userId),
        eq(schema.clients.slug, clientSlug),
        eq(schema.projects.slug, projectSlug),
      ),
    )
    .limit(1);
  const owned = ownership[0];
  if (!owned) {
    return { status: "error", message: "Project not found.", code: "project_not_found" };
  }

  try {
    await setProjectDomain(session.userId, owned.projectId, domainId);
    revalidatePath(`/projects/${clientSlug}/${projectSlug}`);
    revalidatePath(`/projects/${clientSlug}/${projectSlug}/canon`);
    return {
      status: "success",
      message: "Canon domain assigned. The agent will now inherit this domain's canon.",
    };
  } catch (err) {
    if (err instanceof ProjectError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
