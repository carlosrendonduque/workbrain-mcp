import Link from "next/link";
import { listCanonDomainsForUser } from "@/lib/canon-domains";
import { listClientsForUser } from "@/lib/projects";
import { requireSession } from "@/lib/webapp-auth";
import { CreateProjectForm } from "./_components/create-project-form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const session = await requireSession();
  const [clients, domains] = await Promise.all([
    listClientsForUser(session.userId),
    listCanonDomainsForUser(session.userId),
  ]);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <nav className="mb-2 text-xs text-zinc-500">
        <Link href="/projects" className="hover:text-zinc-300">
          Corpus
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-300">new</span>
      </nav>

      <header className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-100">Create a new project</h1>
        <p className="mt-1 text-sm text-zinc-400">
          A project is the unit of isolation in WorkBrain — every document, decision, link and
          search lives inside one project. Cross-project queries are forbidden by design. You can
          have many projects per client (e.g. one per system the client operates).
        </p>
      </header>

      <div className="max-w-3xl">
        <CreateProjectForm clients={clients} domains={domains} />
      </div>
    </div>
  );
}
