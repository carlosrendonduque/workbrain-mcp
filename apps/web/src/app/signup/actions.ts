"use server";

import { SignupTokenError, claimSignupToken } from "@/lib/signup-tokens";

export type SignupActionState =
  | { status: "idle" }
  | { status: "success"; email: string; apiKey: string }
  | { status: "error"; message: string; code?: string };

function readField(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export async function signupAction(
  _prev: SignupActionState,
  formData: FormData,
): Promise<SignupActionState> {
  const rawToken = readField(formData, "token");
  const email = readField(formData, "email");

  if (!rawToken || !email) {
    return {
      status: "error",
      message: "Both invitation token and email are required.",
      code: "missing_fields",
    };
  }

  try {
    const result = await claimSignupToken({ rawToken, email });
    return { status: "success", email: result.email, apiKey: result.apiKey };
  } catch (err) {
    if (err instanceof SignupTokenError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
