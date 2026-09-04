import { and, desc, eq, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type WorkbrainDb, corpusDbFor, schema } from "@/lib/db";
import { getProjectByPath } from "@/lib/projects";
import { requireSession } from "@/lib/webapp-auth";
import { ComposeForm, type DocOption } from "./_components/compose-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ clientSlug: string; projectSlug: string }>;
}

async function listDocsWithExternalId(
  corpusDb: WorkbrainDb,
  projectId: string,
): Promise<DocOption[]> {
  const rows = await corpusDb
    .select({
      externalId: schema.documents.externalId,
      type: schema.documents.type,
      title: schema.documents.title,
    })
    .from(schema.documents)
    .where(and(eq(schema.documents.projectId, projectId), isNotNull(schema.documents.externalId)))
    .orderBy(desc(schema.documents.createdAt))
    .limit(500);
  return rows.filter(
    (r): r is { externalId: string; type: string; title: string } => r.externalId !== null,
  );
}

export default async function ComposePage({ params }: PageProps) {
  const session = await requireSession();
  const { clientSlug, projectSlug } = await params;
  const project = await getProjectByPath(session.userId, clientSlug, projectSlug);
  if (!project) notFound();

  const docs = await listDocsWithExternalId(corpusDbFor(project), project.projectId);
  const projectBasePath = `/projects/${clientSlug}/${projectSlug}`;

  return (
    <div className="px-8 py-8">
      <nav className="mb-2 text-xs text-zinc-500">
        <Link href="/projects" className="hover:text-zinc-300">
          Corpus
        </Link>
        <span className="mx-2">/</span>
        <span className="font-mono">{project.clientSlug}</span>
        <span className="mx-2">/</span>
        <Link href={projectBasePath} className="font-mono hover:text-zinc-300">
          {project.projectSlug}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-300">compose</span>
      </nav>

      <header className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-100">Compose context</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Build the structured bundle the IDE agent receives: canon, focus document, linked
          documents grouped by type, RAG chunks (rerank-aware), stakeholders, and the instructions
          block.
        </p>
      </header>

      <div className="max-w-4xl">
        <ComposeForm clientSlug={clientSlug} projectSlug={projectSlug} docs={docs} />
      </div>
    </div>
  );
}
