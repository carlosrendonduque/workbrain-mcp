import Link from "next/link";
import { notFound } from "next/navigation";
import { listActivity } from "@/lib/audit";
import { getProjectByPath } from "@/lib/projects";
import { requireSession } from "@/lib/webapp-auth";

export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("en-US");

function formatRelative(value: Date | string): string {
  const ts = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(ts)) return "—";
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function statusDot(status: string): { cls: string; label: string } {
  if (status === "success") return { cls: "bg-emerald-500", label: "ok" };
  if (status === "error") return { cls: "bg-red-500", label: "error" };
  return { cls: "bg-zinc-500", label: status };
}

interface PageProps {
  params: Promise<{ clientSlug: string; projectSlug: string }>;
  searchParams: Promise<{ session?: string }>;
}

export default async function ProjectActivityPage({ params, searchParams }: PageProps) {
  const session = await requireSession();
  const { clientSlug, projectSlug } = await params;
  const { session: sessionFilter } = await searchParams;

  const project = await getProjectByPath(session.userId, clientSlug, projectSlug);
  if (!project) notFound();

  const rows = await listActivity(session.userId, null, {
    projectId: project.projectId,
    sessionId: sessionFilter && sessionFilter.length > 0 ? sessionFilter : undefined,
    limit: 100,
  });

  // Group consecutive rows by sessionId for visual cohesion. Same session
  // appears as a single bucket with header.
  const sessionGroups: Array<{
    sessionId: string | null;
    rows: typeof rows;
  }> = [];
  for (const r of rows) {
    const last = sessionGroups[sessionGroups.length - 1];
    if (last && last.sessionId === r.sessionId) {
      last.rows.push(r);
    } else {
      sessionGroups.push({ sessionId: r.sessionId, rows: [r] });
    }
  }

  const projectBasePath = `/projects/${clientSlug}/${projectSlug}`;

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
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
        <span className="text-zinc-300">activity</span>
      </nav>

      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">{project.projectName} · activity</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Mutations on this project — drafts proposed/approved/rejected, documents ingested or
            archived, links created. Reads (search, compose_context) live in{" "}
            <Link href="/audit" className="text-indigo-300 hover:text-indigo-200">
              /audit
            </Link>{" "}
            for forensics. Click a row to see the raw invocation.
          </p>
        </div>
        {sessionFilter ? (
          <Link
            href={`${projectBasePath}/activity`}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
          >
            Clear session filter
          </Link>
        ) : null}
      </header>

      {sessionFilter ? (
        <p className="mb-4 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-200">
          Showing only session <code className="font-mono">{sessionFilter.slice(0, 12)}…</code>
        </p>
      ) : null}

      {sessionGroups.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-500">
          No activity recorded yet for this project. Mutations from the agent (propose_document,
          approve_draft, etc.) and the web UI (canon edits, domain assignments) will appear here as
          they happen.
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[11px] text-zinc-500">
            Showing {NUMBER.format(rows.length)}
            {rows.length === 100 ? " (capped — filter by session for older)" : ""}.
          </p>
          {sessionGroups.map((group, idx) => (
            <div
              key={group.sessionId ?? `web-${idx}`}
              className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40"
            >
              <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">
                    {group.sessionId ? (
                      <>
                        <span className="text-zinc-500">session</span>{" "}
                        <code className="font-mono text-zinc-300">
                          {group.sessionId.slice(0, 12)}…
                        </code>
                      </>
                    ) : (
                      <span className="text-zinc-500">web / no session</span>
                    )}
                  </span>
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-500">
                    {group.rows.length} action{group.rows.length === 1 ? "" : "s"}
                  </span>
                </div>
                {group.sessionId ? (
                  <Link
                    href={`${projectBasePath}/activity?session=${encodeURIComponent(group.sessionId)}`}
                    className="text-zinc-500 hover:text-zinc-300"
                  >
                    isolate this session →
                  </Link>
                ) : null}
              </header>
              <ul className="divide-y divide-zinc-800/70">
                {group.rows.map((r) => {
                  const dot = statusDot(r.status);
                  return (
                    <li key={r.id} className="px-5 py-2.5 text-sm">
                      <div className="flex items-center gap-3">
                        <span
                          role="img"
                          className={`h-2 w-2 rounded-full ${dot.cls}`}
                          aria-label={dot.label}
                        />
                        <span className="text-zinc-200">{r.description}</span>
                        <span className="ml-auto flex items-center gap-3 text-[11px] text-zinc-500">
                          <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono uppercase tracking-wide">
                            {r.actor}
                          </span>
                          <span>{formatRelative(r.ts)}</span>
                          <Link
                            href={`/audit?project=${project.projectId}`}
                            className="text-zinc-600 hover:text-zinc-400"
                            title="View raw invocation in /audit"
                          >
                            ⓘ
                          </Link>
                        </span>
                      </div>
                      {r.errorDetail ? (
                        <p className="mt-1 line-clamp-2 pl-5 font-mono text-[11px] text-red-400">
                          {r.errorDetail}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
