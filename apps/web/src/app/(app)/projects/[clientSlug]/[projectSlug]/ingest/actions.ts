"use server";

import { z } from "zod";
import {
  IngestError,
  IngestPasteInputSchema,
  type IngestPasteResult,
  ingestPaste,
} from "@/lib/paste";
import { requireSession } from "@/lib/webapp-auth";

export type IngestActionState =
  | { status: "idle" }
  | {
      status: "success";
      result: IngestPasteResult;
      clientSlug: string;
      projectSlug: string;
    }
  | { status: "error"; message: string; code?: string };

function readOptional(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export async function ingestPasteAction(
  _prev: IngestActionState,
  formData: FormData,
): Promise<IngestActionState> {
  const session = await requireSession();

  const projectSlug = readOptional(formData, "projectSlug");
  const clientSlug = readOptional(formData, "clientSlug");
  if (!projectSlug || !clientSlug) {
    return { status: "error", message: "Missing project context.", code: "missing_project" };
  }

  const raw = {
    projectSlug,
    title: readOptional(formData, "title") ?? "",
    content: readOptional(formData, "content") ?? "",
    type: readOptional(formData, "type"),
    externalId: readOptional(formData, "externalId"),
    status: readOptional(formData, "status"),
  };

  const parsed = IngestPasteInputSchema.safeParse(raw);
  if (!parsed.success) {
    const flat = z.treeifyError(parsed.error);
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid form input.",
      code: JSON.stringify(flat),
    };
  }

  try {
    const result = await ingestPaste(session.userId, parsed.data, {
      sessionId: null,
      clientScope: null,
    });
    return { status: "success", result, clientSlug, projectSlug };
  } catch (err) {
    if (err instanceof IngestError) {
      return { status: "error", message: err.message, code: err.code };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", message };
  }
}
