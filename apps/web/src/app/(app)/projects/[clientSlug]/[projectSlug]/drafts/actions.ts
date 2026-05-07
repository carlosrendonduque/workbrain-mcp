"use server";

import { revalidatePath } from "next/cache";
import {
  type ApproveDraftEdits,
  type EditDraftInput,
  DraftError,
  approveDraft,
  editDraft,
  rejectDraft,
} from "@/lib/drafts";
import { requireSession } from "@/lib/webapp-auth";

export type DraftActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string; code?: string };

function readField(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function projectPath(clientSlug: string, projectSlug: string): string {
  return `/projects/${clientSlug}/${projectSlug}`;
}

export async function approveAction(
  _prev: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const session = await requireSession();
  const draftId = readField(formData, "draftId");
  const clientSlug = readField(formData, "clientSlug");
  const projectSlug = readField(formData, "projectSlug");
  if (!draftId || !clientSlug || !projectSlug) {
    return { status: "error", message: "Missing fields.", code: "missing_fields" };
  }

  // Optional edits.
  const title = readField(formData, "editTitle");
  const content = readField(formData, "editContent");
  const externalId = readField(formData, "editExternalId");
  const type = readField(formData, "editType");

  const edits: ApproveDraftEdits = {};
  if (type) edits.type = type as ApproveDraftEdits["type"];
  if (title) edits.title = title;
  if (content) edits.content = content;
  if (externalId !== undefined) edits.externalId = externalId.length > 0 ? externalId : null;

  try {
    const result = await approveDraft(session.userId, draftId, edits);
    revalidatePath(`${projectPath(clientSlug, projectSlug)}/drafts`);
    revalidatePath(projectPath(clientSlug, projectSlug));
    return {
      status: "success",
      message: `Approved → ingested as ${result.ingested.path}.`,
    };
  } catch (err) {
    if (err instanceof DraftError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export async function rejectAction(
  _prev: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const session = await requireSession();
  const draftId = readField(formData, "draftId");
  const clientSlug = readField(formData, "clientSlug");
  const projectSlug = readField(formData, "projectSlug");
  if (!draftId || !clientSlug || !projectSlug) {
    return { status: "error", message: "Missing fields.", code: "missing_fields" };
  }

  try {
    await rejectDraft(session.userId, draftId);
    revalidatePath(`${projectPath(clientSlug, projectSlug)}/drafts`);
    return { status: "success", message: "Draft rejected." };
  } catch (err) {
    if (err instanceof DraftError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export async function editAction(
  _prev: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const session = await requireSession();
  const draftId = readField(formData, "draftId");
  const clientSlug = readField(formData, "clientSlug");
  const projectSlug = readField(formData, "projectSlug");
  if (!draftId || !clientSlug || !projectSlug) {
    return { status: "error", message: "Missing fields.", code: "missing_fields" };
  }
  const title = readField(formData, "title");
  const content = readField(formData, "content");
  const externalId = readField(formData, "externalId");
  const type = readField(formData, "type");

  const editInput: EditDraftInput = {};
  if (title) editInput.title = title;
  if (content) editInput.content = content;
  if (externalId !== undefined) {
    editInput.externalId = externalId.length > 0 ? externalId : null;
  }
  if (type) editInput.type = type as EditDraftInput["type"];

  try {
    await editDraft(session.userId, draftId, editInput);
    revalidatePath(`${projectPath(clientSlug, projectSlug)}/drafts`);
    return { status: "success", message: "Draft updated." };
  } catch (err) {
    if (err instanceof DraftError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
