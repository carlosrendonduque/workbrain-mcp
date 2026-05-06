"use server";

import { redirect } from "next/navigation";
import { clearSession, resolveApiKey, startSession } from "@/lib/webapp-auth";

const KEY_PATTERN = /^wbk_[a-f0-9]{64}$/;
const SAFE_NEXT_PATTERN = /^\/[a-zA-Z0-9/_-]*$/;

export interface LoginState {
  error: string | null;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const rawKey = String(formData.get("apiKey") ?? "").trim();
  const next = String(formData.get("next") ?? "/dashboard");

  if (!KEY_PATTERN.test(rawKey)) {
    return { error: "Format invalid. Expected wbk_<64 hex chars>." };
  }

  const resolved = await resolveApiKey(rawKey);
  if (!resolved) {
    return { error: "Key not recognized." };
  }

  await startSession({
    userId: resolved.userId,
    email: resolved.email,
    apiKeyId: resolved.apiKeyId,
  });

  const target = SAFE_NEXT_PATTERN.test(next) ? next : "/dashboard";
  redirect(target);
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect("/login");
}
