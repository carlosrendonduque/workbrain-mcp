"use server";

import { revalidatePath } from "next/cache";
import { saveUserCanon } from "@/lib/user-canon";
import { requireSession } from "@/lib/webapp-auth";

export type SaveUserCanonState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

function readField(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function saveUserCanonAction(
  _prev: SaveUserCanonState,
  formData: FormData,
): Promise<SaveUserCanonState> {
  const session = await requireSession();

  try {
    await saveUserCanon(session.userId, {
      conventions: readField(formData, "conventions"),
      guidelines: readField(formData, "guidelines"),
      architecture: readField(formData, "architecture"),
    });
    revalidatePath("/account/canon");
    return {
      status: "success",
      message:
        "Personal canon saved. It now applies as the default for all your projects (project canon overrides where set).",
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
