import Link from "next/link";
import { notFound } from "next/navigation";
import { listCanonDomainsForUser } from "@/lib/canon-domains";
import { getProjectByPath } from "@/lib/projects";
import { requireSession } from "@/lib/webapp-auth";
import { CanonForm } from "./_components/canon-form";
import { ProjectDomainForm } from "./_components/domain-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ clientSlug: string; projectSlug: string }>;
}

export default async function CanonEditorPage({ params }: PageProps) {
  const session = await requireSession();
  const { clientSlug, projectSlug } = await params;
  const project = await getProjectByPath(session.userId, clientSlug, projectSlug);
  if (!project) notFound();
  const domains = await listCanonDomainsForUser(session.userId);

  const projectBasePath = `/projects/${clientSlug}/${projectSlug}`;

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
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
        <span className="text-zinc-300">canon</span>
      </nav>

      <header className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-100">Canon</h1>
        <p className="mt-1 text-sm text-zinc-400">
          The conventions, guidelines and architecture that frame every prompt for this project.
          Injected into <code className="font-mono">compose_context</code> as the rules the agent
          should never override.
        </p>
      </header>

      <div className="max-w-3xl space-y-4">
        <ProjectDomainForm
          clientSlug={clientSlug}
          projectSlug={projectSlug}
          currentDomainId={project.domainId}
          currentDomainSlug={project.domainSlug}
          currentDomainName={project.domainName}
          domains={domains}
        />
        <CanonForm
          clientSlug={clientSlug}
          projectSlug={projectSlug}
          conventions={project.conventions}
          guidelines={project.guidelines}
          architecture={project.architecture}
        />
      </div>
    </div>
  );
}
