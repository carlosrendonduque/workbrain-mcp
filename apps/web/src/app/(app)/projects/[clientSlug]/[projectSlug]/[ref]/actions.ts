"use server";

import { revalidatePath } from "next/cache";
import { CurationError, archiveDocument, unarchiveDocument } from "@/lib/curation";
import { LinkError, type LinkType, linkDocuments } from "@/lib/links";
import { requireSession } from "@/lib/webapp-auth";

export type CurationActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string; code?: string };

function readOptional(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function projectPath(clientSlug: string, projectSlug: string, ref: string): string {
  return `/projects/${clientSlug}/${projectSlug}/${ref}`;
}

interface RouteContext {
  clientSlug: string;
  projectSlug: string;
  ref: string;
  thisDocPath: string;
}

function readRoute(formData: FormData): RouteContext | { error: CurationActionState } {
  const clientSlug = readOptional(formData, "clientSlug");
  const projectSlug = readOptional(formData, "projectSlug");
  const ref = readOptional(formData, "ref");
  const thisDocPath = readOptional(formData, "thisDocPath");
  if (!clientSlug || !projectSlug || !ref || !thisDocPath) {
    return {
      error: { status: "error", message: "Missing route context.", code: "missing_route" },
    };
  }
  return { clientSlug, projectSlug, ref, thisDocPath };
}

export async function addLinkAction(
  _prev: CurationActionState,
  formData: FormData,
): Promise<CurationActionState> {
  const session = await requireSession();
  const route = readRoute(formData);
  if ("error" in route) return route.error;

  const toExternalId = readOptional(formData, "toExternalId");
  const linkType = readOptional(formData, "linkType") as LinkType | undefined;
  const note = readOptional(formData, "note");

  if (!toExternalId || !linkType) {
    return {
      status: "error",
      message: "Pick a target document and link type.",
      code: "missing_fields",
    };
  }

  try {
    const result = await linkDocuments(session.userId, {
      projectSlug: route.projectSlug,
      fromPath: route.thisDocPath,
      toExternalId,
      linkType,
      note,
    });
    revalidatePath(projectPath(route.clientSlug, route.projectSlug, route.ref));
    return {
      status: "success",
      message: result.alreadyExisted
        ? `Link already existed (${linkType} → ${toExternalId}).`
        : `Linked (${linkType} → ${toExternalId}).`,
    };
  } catch (err) {
    if (err instanceof LinkError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function markSupersededAction(
  _prev: CurationActionState,
  formData: FormData,
): Promise<CurationActionState> {
  const session = await requireSession();
  const route = readRoute(formData);
  if ("error" in route) return route.error;

  const fromExternalId = readOptional(formData, "fromExternalId");
  const alsoArchive = readOptional(formData, "alsoArchive") === "on";
  const documentId = readOptional(formData, "documentId");

  if (!fromExternalId) {
    return {
      status: "error",
      message: "Pick the new (superseding) document.",
      code: "missing_fields",
    };
  }

  try {
    const link = await linkDocuments(session.userId, {
      projectSlug: route.projectSlug,
      fromExternalId,
      toPath: route.thisDocPath,
      linkType: "supersedes",
      note: "marked as superseded from webapp",
    });

    if (alsoArchive) {
      if (!documentId) {
        return {
          status: "error",
          message: "Missing documentId for auto-archive.",
          code: "missing_doc_id",
        };
      }
      await archiveDocument(session.userId, documentId);
    }

    revalidatePath(projectPath(route.clientSlug, route.projectSlug, route.ref));
    const linkPart = link.alreadyExisted ? "already linked" : "linked";
    const archivePart = alsoArchive ? " and archived" : "";
    return {
      status: "success",
      message: `Marked superseded by ${fromExternalId} (${linkPart})${archivePart}.`,
    };
  } catch (err) {
    if (err instanceof LinkError || err instanceof CurationError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function archiveAction(
  _prev: CurationActionState,
  formData: FormData,
): Promise<CurationActionState> {
  const session = await requireSession();
  const route = readRoute(formData);
  if ("error" in route) return route.error;

  const documentId = readOptional(formData, "documentId");
  const op = readOptional(formData, "op");

  if (!documentId || !op) {
    return { status: "error", message: "Missing fields.", code: "missing_fields" };
  }

  try {
    if (op === "archive") {
      await archiveDocument(session.userId, documentId);
    } else if (op === "unarchive") {
      await unarchiveDocument(session.userId, documentId);
    } else {
      return { status: "error", message: `Unknown op: ${op}`, code: "bad_op" };
    }
    revalidatePath(projectPath(route.clientSlug, route.projectSlug, route.ref));
    return {
      status: "success",
      message: op === "archive" ? "Document archived." : "Document unarchived.",
    };
  } catch (err) {
    if (err instanceof CurationError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
