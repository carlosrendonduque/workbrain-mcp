import Link from "next/link";
import { notFound } from "next/navigation";
import { listDrafts } from "@/lib/drafts";
import { getProjectByPath } from "@/lib/projects";
import { requireSession } from "@/lib/webapp-auth";
import { DraftsList } from "./_components/drafts-list";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ clientSlug: string; projectSlug: string }>;
  searchParams: Promise<{ status?: string }>;
}

const STATUS_FILTERS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
] as const;

export default async function DraftsPage({ params, searchParams }: PageProps) {
  const session = await requireSession();
  const { clientSlug, projectSlug } = await params;
  const sp = await searchParams;

  const project = await getProjectByPath(session.userId, clientSlug, projectSlug);
  if (!project) notFound();

  const projectBasePath = `/projects/${clientSlug}/${projectSlug}`;
  const requestedStatus = sp.status === "approved" || sp.status === "rejected" || sp.status === "pending" || sp.status === "all"
    ? sp.status
    : "pending";
  const statusFilter = requestedStatus === "all" ? undefined : requestedStatus;

  const drafts = await listDrafts(session.userId, {
    projectSlug,
    status: statusFilter,
  });

  return (
    <div className="px-8 py-8">
      <nav className="mb-2 text-xs text-zinc-500">
        <Link href="/projects" className="hover:text-zinc-300">
          Projects
        </Link>
        <span className="mx-2">/</span>
        <span className="font-mono">{project.clientSlug}</span>
        <span className="mx-2">/</span>
        <Link href={projectBasePath} className="font-mono hover:text-zinc-300">
          {project.projectSlug}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-300">drafts</span>
      </nav>

      <header className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-100">Drafts</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Documents the agent proposed during conversations. Nothing here is in the
          corpus yet — review, approve or discard. Approved drafts run through the
          normal ingest pipeline (chunking, embedding, auto-linking) and become real
          documents.
        </p>
      </header>

      <section className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-zinc-500">filter:</span>
        {STATUS_FILTERS.map((f) => {
          const active = requestedStatus === f.value;
          const href = f.value === "pending" ? `${projectBasePath}/drafts` : `${projectBasePath}/drafts?status=${f.value}`;
          return (
            <Link
              key={f.value}
              href={href}
              className={`rounded-full px-3 py-1 text-xs ${
                active
                  ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/40"
                  : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </section>

      <DraftsList
        drafts={drafts}
        clientSlug={clientSlug}
        projectSlug={projectSlug}
        projectBasePath={projectBasePath}
      />
    </div>
  );
}
