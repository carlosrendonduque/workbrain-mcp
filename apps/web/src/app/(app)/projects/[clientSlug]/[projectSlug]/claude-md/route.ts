import { NextResponse } from "next/server";
import { renderClaudeMd } from "@/lib/claude-md";
import { getProjectByPath } from "@/lib/projects";
import { requireSession } from "@/lib/webapp-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ clientSlug: string; projectSlug: string }> },
): Promise<NextResponse> {
  const session = await requireSession();
  const { clientSlug, projectSlug } = await ctx.params;
  const project = await getProjectByPath(session.userId, clientSlug, projectSlug);
  if (!project) {
    return new NextResponse("Project not found.", { status: 404 });
  }

  const body = renderClaudeMd({
    clientSlug: project.clientSlug,
    projectSlug: project.projectSlug,
    projectName: project.projectName,
    clientName: project.clientName,
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="CLAUDE.md"`,
    },
  });
}
