"use server";

import { revalidatePath } from "next/cache";
import { SignupTokenError, createSignupToken, revokeSignupToken } from "@/lib/signup-tokens";
import { requireSession } from "@/lib/webapp-auth";

export type CreateTokenState =
  | { status: "idle" }
  | { status: "success"; rawToken: string; label: string }
  | { status: "error"; message: string; code?: string };

export type RevokeTokenState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string; code?: string };

const PATH = "/account/invite-tokens";

function readField(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export async function createTokenAction(
  _prev: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> {
  const session = await requireSession();
  const label = readField(formData, "label");
  const expiresInDaysRaw = readField(formData, "expiresInDays");
  const expiresInDays = expiresInDaysRaw ? Number.parseInt(expiresInDaysRaw, 10) : undefined;

  if (!label) {
    return { status: "error", message: "Label is required.", code: "missing_label" };
  }

  try {
    const created = await createSignupToken(session.userId, {
      label,
      expiresInDays:
        Number.isFinite(expiresInDays) && expiresInDays !== undefined ? expiresInDays : undefined,
    });
    revalidatePath(PATH);
    return { status: "success", rawToken: created.rawToken, label: created.label };
  } catch (err) {
    if (err instanceof SignupTokenError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export async function revokeTokenAction(
  _prev: RevokeTokenState,
  formData: FormData,
): Promise<RevokeTokenState> {
  const session = await requireSession();
  const tokenId = readField(formData, "tokenId");
  const label = readField(formData, "label");
  if (!tokenId) {
    return { status: "error", message: "Missing tokenId.", code: "missing_id" };
  }

  try {
    await revokeSignupToken(session.userId, tokenId);
    revalidatePath(PATH);
    return {
      status: "success",
      message: label ? `Revoked "${label}".` : "Revoked.",
    };
  } catch (err) {
    if (err instanceof SignupTokenError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
