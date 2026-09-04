import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { callerFromHeaders } from "@/lib/caller";
import { db, schema } from "@/lib/db";

export async function GET(): Promise<NextResponse> {
  const h = await headers();
  const caller = callerFromHeaders(h);
  if (!caller) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "unauthorized", message: "Missing user context." },
      },
      { status: 401 },
    );
  }

  // This is what the MCP server calls to validate set_active_project, so it
  // doubles as a directory of everything the caller may reach. A key pinned
  // to one client must not see the others listed here — that would hand it
  // the slugs of engagements it has no business knowing exist.
  const filters = [eq(schema.clients.userId, caller.userId)];
  if (caller.clientScope !== null) {
    filters.push(eq(schema.clients.id, caller.clientScope));
  }

  const rows = await db
    .select({
      projectId: schema.projects.id,
      projectSlug: schema.projects.slug,
      projectName: schema.projects.name,
      persist: schema.projects.persist,
      clientId: schema.clients.id,
      clientSlug: schema.clients.slug,
      clientName: schema.clients.name,
    })
    .from(schema.projects)
    .innerJoin(schema.clients, eq(schema.projects.clientId, schema.clients.id))
    .where(and(...filters))
    .orderBy(schema.clients.slug, schema.projects.slug);

  return NextResponse.json({ ok: true, data: rows });
}
