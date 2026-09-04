"use server";

import { revalidatePath } from "next/cache";
import { ApiKeyError, countApiKeys, createApiKey, revokeApiKey } from "@/lib/api-keys";
import { requireSession } from "@/lib/webapp-auth";

export type CreateKeyState =
  | { status: "idle" }
  | { status: "success"; rawKey: string; label: string; clientSlug: string | null }
  | { status: "error"; message: string; code?: string };

export type RevokeKeyState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string; code?: string };

const ACCOUNT_PATH = "/account/api-keys";

export async function createKeyAction(
  _prev: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  const session = await requireSession();
  const label = formData.get("label");
  if (typeof label !== "string" || label.trim().length === 0) {
    return { status: "error", message: "Label is required.", code: "missing_label" };
  }

  // Empty string from the "every client" option in the picker.
  const clientIdRaw = formData.get("clientId");
  const clientId = typeof clientIdRaw === "string" && clientIdRaw.length > 0 ? clientIdRaw : null;

  try {
    const created = await createApiKey(session.userId, label, clientId);
    revalidatePath(ACCOUNT_PATH);
    return {
      status: "success",
      rawKey: created.rawKey,
      label: created.label,
      clientSlug: created.clientSlug,
    };
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export async function revokeKeyAction(
  _prev: RevokeKeyState,
  formData: FormData,
): Promise<RevokeKeyState> {
  const session = await requireSession();
  const apiKeyId = formData.get("apiKeyId");
  const label = formData.get("label");
  if (typeof apiKeyId !== "string" || apiKeyId.length === 0) {
    return { status: "error", message: "Missing apiKeyId.", code: "missing_id" };
  }

  // Defense: do not let the user revoke their last key — they would lock
  // themselves out of the API surface.
  const remaining = await countApiKeys(session.userId);
  if (remaining <= 1) {
    return {
      status: "error",
      message: "Cannot revoke your last API key. Create a new one first.",
      code: "last_key",
    };
  }

  try {
    await revokeApiKey(session.userId, apiKeyId);
    revalidatePath(ACCOUNT_PATH);
    return {
      status: "success",
      message: typeof label === "string" ? `Revoked "${label}".` : "Revoked.",
    };
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
