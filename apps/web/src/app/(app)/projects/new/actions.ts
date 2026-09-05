"use server";

import { redirect } from "next/navigation";
import { ProjectError, createProject } from "@/lib/projects";
import { requireSession } from "@/lib/webapp-auth";

export type CreateProjectState =
  | { status: "idle" }
  | { status: "error"; message: string; code?: string };

function readField(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export async function createProjectAction(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const session = await requireSession();

  const mode = readField(formData, "mode") ?? "existing";
  const projectSlug = readField(formData, "projectSlug");
  const projectName = readField(formData, "projectName");
  const persist = formData.get("persist") === "on";

  if (!projectSlug || !projectName) {
    return {
      status: "error",
      message: "Project slug and name are required.",
      code: "missing_fields",
    };
  }

  const repoUrl = readField(formData, "repoUrl");
  const defaultBranch = readField(formData, "defaultBranch");
  const domainId = readField(formData, "domainId");

  if (!domainId) {
    return {
      status: "error",
      message: "Pick a canon domain. Create one at /account/canons if you don't have any yet.",
      code: "missing_domain",
    };
  }

  try {
    let result: Awaited<ReturnType<typeof createProject>>;
    if (mode === "new-client") {
      const newClientSlug = readField(formData, "newClientSlug");
      const newClientName = readField(formData, "newClientName");
      if (!newClientSlug || !newClientName) {
        return {
          status: "error",
          message: "New client slug and name are required.",
          code: "missing_client",
        };
      }
      result = await createProject(session.userId, {
        newClientSlug,
        newClientName,
        projectSlug,
        projectName,
        persist,
        repoUrl,
        defaultBranch,
        domainId,
      });
    } else {
      const existingClientId = readField(formData, "existingClientId");
      if (!existingClientId) {
        return {
          status: "error",
          message: "Pick a client from the dropdown or switch to 'New client' mode.",
          code: "missing_client_id",
        };
      }
      result = await createProject(session.userId, {
        existingClientId,
        projectSlug,
        projectName,
        persist,
        repoUrl,
        defaultBranch,
        domainId,
      });
    }

    redirect(`/projects/${result.clientSlug}/${result.projectSlug}`);
  } catch (err) {
    // next/navigation throws a special error on redirect — let it bubble.
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    if (
      typeof err === "object" &&
      err !== null &&
      "digest" in err &&
      typeof (err as { digest: unknown }).digest === "string" &&
      (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    if (err instanceof ProjectError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
