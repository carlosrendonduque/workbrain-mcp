"use server";

import { ComposeError, type ComposeContextResult, composeContext } from "@/lib/compose";
import { requireSession } from "@/lib/webapp-auth";

export type ComposeActionState =
  | { status: "idle" }
  | {
      status: "success";
      result: ComposeContextResult;
      clientSlug: string;
      projectSlug: string;
    }
  | { status: "error"; message: string; code?: string };

function readOptional(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export async function composeAction(
  _prev: ComposeActionState,
  formData: FormData,
): Promise<ComposeActionState> {
  const session = await requireSession();

  const projectSlug = readOptional(formData, "projectSlug");
  const clientSlug = readOptional(formData, "clientSlug");
  const mode = readOptional(formData, "mode") ?? "focusExternalId";
  if (!projectSlug || !clientSlug) {
    return { status: "error", message: "Missing project context.", code: "missing_project" };
  }

  const focusExternalId = mode === "focusExternalId" ? readOptional(formData, "focusExternalId") : undefined;
  const focusText = mode === "focusText" ? readOptional(formData, "focusText") : undefined;
  if (!focusExternalId && !focusText) {
    return {
      status: "error",
      message:
        mode === "focusExternalId"
          ? "Pick a document from the dropdown."
          : "Type something in the free-text box.",
      code: "missing_focus",
    };
  }

  try {
    const result = await composeContext(session.userId, {
      projectSlug,
      ...(focusExternalId ? { focusExternalId } : {}),
      ...(focusText ? { focusText } : {}),
    });
    return { status: "success", result, clientSlug, projectSlug };
  } catch (err) {
    if (err instanceof ComposeError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
