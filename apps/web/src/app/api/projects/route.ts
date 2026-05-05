import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";

export async function GET(): Promise<NextResponse> {
  const h = await headers();
  const userId = h.get("x-user-id");
  if (!userId) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "unauthorized", message: "Missing user context." },
      },
      { status: 401 },
    );
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
    .where(eq(schema.clients.userId, userId))
    .orderBy(schema.clients.slug, schema.projects.slug);

  return NextResponse.json({ ok: true, data: rows });
}
