import Link from "next/link";
import { requireSession } from "@/lib/webapp-auth";
import { getProjectsForUser } from "@/lib/stats";

export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("en-US");

export default async function ProjectsIndexPage() {
  const session = await requireSession();
  const projects = await getProjectsForUser(session.userId);

  return (
    <div className="px-8 py-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Corpus</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Pick a project to browse its documents. Each project is fully isolated.
          </p>
        </div>
        <Link
          href="/projects/new"
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500"
        >
          + New project
        </Link>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-400">
          No projects yet. Click <span className="text-zinc-200">+ New project</span> above
          to create your first one.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-5 py-2 text-left font-medium">Project</th>
                <th className="px-5 py-2 text-right font-medium">Docs</th>
                <th className="px-5 py-2 text-right font-medium">Chunks</th>
                <th className="px-5 py-2 text-right font-medium">Persist</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {projects.map((p) => (
                <tr key={p.projectId} className="group hover:bg-zinc-900/40">
                  <td className="px-5 py-3">
                    <Link
                      href={`/projects/${p.clientSlug}/${p.projectSlug}`}
                      className="block"
                    >
                      <div className="font-medium text-zinc-100 group-hover:text-indigo-300">
                        {p.projectName}
                      </div>
                      <div className="font-mono text-xs text-zinc-500">
                        {p.clientSlug}/{p.projectSlug}
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-zinc-300">
                    {NUMBER.format(p.documentCount)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-zinc-300">
                    {NUMBER.format(p.chunkCount)}
                  </td>
                  <td className="px-5 py-3 text-right text-xs">
                    {p.persist ? (
                      <span className="rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">
                        persist
                      </span>
                    ) : (
                      <span className="rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-amber-300">
                        ephemeral
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
