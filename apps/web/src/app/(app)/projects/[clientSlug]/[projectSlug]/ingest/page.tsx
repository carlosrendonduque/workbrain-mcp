import Link from "next/link";
import { notFound } from "next/navigation";
import { getProjectByPath } from "@/lib/projects";
import { requireSession } from "@/lib/webapp-auth";
import { PasteForm } from "./_components/paste-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ clientSlug: string; projectSlug: string }>;
}

export default async function IngestPage({ params }: PageProps) {
  const session = await requireSession();
  const { clientSlug, projectSlug } = await params;
  const project = await getProjectByPath(session.userId, clientSlug, projectSlug);
  if (!project) notFound();

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
        <span className="text-zinc-300">ingest</span>
      </nav>

      <header className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-100">Ingest new document</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Paste a ticket, email, decision, note or transcript. The classifier infers type
          and external_id when omitted. Auto-links any external IDs that already exist in
          this project.
        </p>
      </header>

      <div className="max-w-3xl">
        <PasteForm clientSlug={clientSlug} projectSlug={projectSlug} />
      </div>
    </div>
  );
}
