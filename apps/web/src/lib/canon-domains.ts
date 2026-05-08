import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db";

export interface CanonDomainSummary {
  domainId: string;
  slug: string;
  name: string;
  hasConventions: boolean;
  hasGuidelines: boolean;
  hasArchitecture: boolean;
  projectCount: number;
  updatedAt: Date | string;
}

export interface CanonDomainDetail {
  domainId: string;
  slug: string;
  name: string;
  conventions: string | null;
  guidelines: string | null;
  architecture: string | null;
  updatedAt: Date | string;
}

export class CanonDomainError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "CanonDomainError";
    this.code = code;
    this.status = status;
  }
}

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function validateSlug(value: string): void {
  if (!SLUG_PATTERN.test(value)) {
    throw new CanonDomainError(
      "invalid_slug",
      `Domain slug must be lowercase letters, numbers and dashes (1-64 chars, no leading/trailing dash). Got: "${value}".`,
      400,
    );
  }
}

export async function listCanonDomainsForUser(userId: string): Promise<CanonDomainSummary[]> {
  const rows = await db
    .select({
      domainId: schema.canonDomains.id,
      slug: schema.canonDomains.slug,
      name: schema.canonDomains.name,
      conventions: schema.canonDomains.conventions,
      guidelines: schema.canonDomains.guidelines,
      architecture: schema.canonDomains.architecture,
      updatedAt: schema.canonDomains.updatedAt,
    })
    .from(schema.canonDomains)
    .where(eq(schema.canonDomains.userId, userId))
    .orderBy(schema.canonDomains.slug);

  if (rows.length === 0) return [];

  const counts = await db
    .select({
      domainId: schema.projects.domainId,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.projects.clientId))
    .where(eq(schema.clients.userId, userId))
    .groupBy(schema.projects.domainId);

  const countMap = new Map<string, number>();
  for (const c of counts) {
    if (c.domainId) countMap.set(c.domainId, c.n);
  }

  return rows.map((r) => ({
    domainId: r.domainId,
    slug: r.slug,
    name: r.name,
    hasConventions: Boolean(r.conventions && r.conventions.trim().length > 0),
    hasGuidelines: Boolean(r.guidelines && r.guidelines.trim().length > 0),
    hasArchitecture: Boolean(r.architecture && r.architecture.trim().length > 0),
    projectCount: countMap.get(r.domainId) ?? 0,
    updatedAt: r.updatedAt,
  }));
}

export async function getCanonDomainBySlug(
  userId: string,
  slug: string,
): Promise<CanonDomainDetail | null> {
  const rows = await db
    .select({
      domainId: schema.canonDomains.id,
      slug: schema.canonDomains.slug,
      name: schema.canonDomains.name,
      conventions: schema.canonDomains.conventions,
      guidelines: schema.canonDomains.guidelines,
      architecture: schema.canonDomains.architecture,
      updatedAt: schema.canonDomains.updatedAt,
    })
    .from(schema.canonDomains)
    .where(
      and(
        eq(schema.canonDomains.userId, userId),
        eq(schema.canonDomains.slug, slug),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getCanonDomainById(
  userId: string,
  domainId: string,
): Promise<CanonDomainDetail | null> {
  const rows = await db
    .select({
      domainId: schema.canonDomains.id,
      slug: schema.canonDomains.slug,
      name: schema.canonDomains.name,
      conventions: schema.canonDomains.conventions,
      guidelines: schema.canonDomains.guidelines,
      architecture: schema.canonDomains.architecture,
      updatedAt: schema.canonDomains.updatedAt,
    })
    .from(schema.canonDomains)
    .where(
      and(
        eq(schema.canonDomains.userId, userId),
        eq(schema.canonDomains.id, domainId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface CreateCanonDomainInput {
  slug: string;
  name: string;
}

export async function createCanonDomain(
  userId: string,
  input: CreateCanonDomainInput,
): Promise<CanonDomainDetail> {
  validateSlug(input.slug);
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    throw new CanonDomainError("missing_name", "Domain name is required.", 400);
  }

  const existing = await db
    .select({ id: schema.canonDomains.id })
    .from(schema.canonDomains)
    .where(
      and(
        eq(schema.canonDomains.userId, userId),
        eq(schema.canonDomains.slug, input.slug),
      ),
    )
    .limit(1);
  if (existing[0]) {
    throw new CanonDomainError(
      "duplicate_slug",
      `A canon domain with slug "${input.slug}" already exists.`,
      409,
    );
  }

  const inserted = await db
    .insert(schema.canonDomains)
    .values({ userId, slug: input.slug, name: trimmedName })
    .returning({
      domainId: schema.canonDomains.id,
      slug: schema.canonDomains.slug,
      name: schema.canonDomains.name,
      conventions: schema.canonDomains.conventions,
      guidelines: schema.canonDomains.guidelines,
      architecture: schema.canonDomains.architecture,
      updatedAt: schema.canonDomains.updatedAt,
    });

  const row = inserted[0];
  if (!row) {
    throw new CanonDomainError("insert_failed", "Failed to create canon domain.", 500);
  }
  return row;
}

export interface SaveCanonDomainContentInput {
  conventions: string | null;
  guidelines: string | null;
  architecture: string | null;
}

export async function saveCanonDomainContent(
  userId: string,
  slug: string,
  input: SaveCanonDomainContentInput,
): Promise<void> {
  const result = await db
    .update(schema.canonDomains)
    .set({
      conventions: input.conventions,
      guidelines: input.guidelines,
      architecture: input.architecture,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(schema.canonDomains.userId, userId),
        eq(schema.canonDomains.slug, slug),
      ),
    )
    .returning({ id: schema.canonDomains.id });

  if (result.length === 0) {
    throw new CanonDomainError(
      "not_found",
      `Canon domain "${slug}" not found for this user.`,
      404,
    );
  }
}

export interface MergedCanon {
  conventions: string | null;
  guidelines: string | null;
  architecture: string | null;
  source: {
    conventions: "project" | "domain" | "none";
    guidelines: "project" | "domain" | "none";
    architecture: "project" | "domain" | "none";
  };
  domain: { slug: string; name: string } | null;
}

// Project canon overrides domain canon where it exists; domain canon fills
// in where the project is silent. When a project has no domain assigned,
// only the project's own canon is used. Returns metadata about which layer
// fed each field so callers (compose_context) can be transparent about it.
export function mergeCanon(
  project: {
    conventions: string | null;
    guidelines: string | null;
    architecture: string | null;
  },
  domain: {
    slug: string;
    name: string;
    conventions: string | null;
    guidelines: string | null;
    architecture: string | null;
  } | null,
): MergedCanon {
  const pick = (
    p: string | null,
    d: string | null,
  ): { value: string | null; source: "project" | "domain" | "none" } => {
    if (p && p.trim().length > 0) return { value: p, source: "project" };
    if (d && d.trim().length > 0) return { value: d, source: "domain" };
    return { value: null, source: "none" };
  };

  const c = pick(project.conventions, domain?.conventions ?? null);
  const g = pick(project.guidelines, domain?.guidelines ?? null);
  const a = pick(project.architecture, domain?.architecture ?? null);

  return {
    conventions: c.value,
    guidelines: g.value,
    architecture: a.value,
    source: {
      conventions: c.source,
      guidelines: g.source,
      architecture: a.source,
    },
    domain: domain ? { slug: domain.slug, name: domain.name } : null,
  };
}
