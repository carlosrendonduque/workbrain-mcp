"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  CanonDomainError,
  createCanonDomain,
  saveCanonDomainContent,
} from "@/lib/canon-domains";
import { requireSession } from "@/lib/webapp-auth";

export type CanonDomainState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string; code?: string };

function readField(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function createCanonDomainAction(
  _prev: CanonDomainState,
  formData: FormData,
): Promise<CanonDomainState> {
  const session = await requireSession();
  const slug = readField(formData, "slug");
  const name = readField(formData, "name");

  if (!slug || !name) {
    return {
      status: "error",
      message: "Both slug and name are required.",
      code: "missing_fields",
    };
  }

  try {
    await createCanonDomain(session.userId, { slug, name });
    revalidatePath("/account/canons");
    redirect(`/account/canons/${slug}`);
  } catch (err) {
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
    if (err instanceof CanonDomainError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function saveCanonDomainAction(
  _prev: CanonDomainState,
  formData: FormData,
): Promise<CanonDomainState> {
  const session = await requireSession();
  const slug = readField(formData, "slug");
  if (!slug) {
    return { status: "error", message: "Missing domain slug.", code: "missing_slug" };
  }

  try {
    await saveCanonDomainContent(session.userId, slug, {
      conventions: readField(formData, "conventions"),
      guidelines: readField(formData, "guidelines"),
      architecture: readField(formData, "architecture"),
    });
    revalidatePath("/account/canons");
    revalidatePath(`/account/canons/${slug}`);
    return {
      status: "success",
      message: `Canon domain "${slug}" saved. Project canon overrides where it's set.`,
    };
  } catch (err) {
    if (err instanceof CanonDomainError) {
      return { status: "error", message: err.message, code: err.code };
    }
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
