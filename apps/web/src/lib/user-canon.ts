import { eq, sql } from "drizzle-orm";
import { db, schema } from "./db";

export interface UserCanon {
  conventions: string | null;
  guidelines: string | null;
  architecture: string | null;
  updatedAt: Date | string | null;
}

const EMPTY: UserCanon = {
  conventions: null,
  guidelines: null,
  architecture: null,
  updatedAt: null,
};

export async function getUserCanon(userId: string): Promise<UserCanon> {
  const rows = await db
    .select({
      conventions: schema.userCanon.conventions,
      guidelines: schema.userCanon.guidelines,
      architecture: schema.userCanon.architecture,
      updatedAt: schema.userCanon.updatedAt,
    })
    .from(schema.userCanon)
    .where(eq(schema.userCanon.userId, userId))
    .limit(1);
  return rows[0] ?? EMPTY;
}

export interface SaveUserCanonInput {
  conventions: string | null;
  guidelines: string | null;
  architecture: string | null;
}

export async function saveUserCanon(
  userId: string,
  input: SaveUserCanonInput,
): Promise<void> {
  await db
    .insert(schema.userCanon)
    .values({
      userId,
      conventions: input.conventions,
      guidelines: input.guidelines,
      architecture: input.architecture,
    })
    .onConflictDoUpdate({
      target: schema.userCanon.userId,
      set: {
        conventions: input.conventions,
        guidelines: input.guidelines,
        architecture: input.architecture,
        updatedAt: sql`now()`,
      },
    });
}

export interface MergedCanon {
  conventions: string | null;
  guidelines: string | null;
  architecture: string | null;
  source: {
    conventions: "project" | "user" | "none";
    guidelines: "project" | "user" | "none";
    architecture: "project" | "user" | "none";
  };
}

// Project canon overrides user canon where it exists; user canon fills in
// where the project is silent. Returns metadata about which layer fed each
// field so callers (compose_context) can be transparent about it.
export function mergeCanon(
  project: { conventions: string | null; guidelines: string | null; architecture: string | null },
  user: UserCanon,
): MergedCanon {
  const pick = (
    p: string | null,
    u: string | null,
  ): { value: string | null; source: "project" | "user" | "none" } => {
    if (p && p.trim().length > 0) return { value: p, source: "project" };
    if (u && u.trim().length > 0) return { value: u, source: "user" };
    return { value: null, source: "none" };
  };

  const c = pick(project.conventions, user.conventions);
  const g = pick(project.guidelines, user.guidelines);
  const a = pick(project.architecture, user.architecture);

  return {
    conventions: c.value,
    guidelines: g.value,
    architecture: a.value,
    source: {
      conventions: c.source,
      guidelines: g.source,
      architecture: a.source,
    },
  };
}
