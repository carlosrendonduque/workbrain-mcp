import Link from "next/link";
import { listInvocations, getDistinctOperations } from "@/lib/audit";
import { getProjectsForUser } from "@/lib/stats";
import { requireSession } from "@/lib/webapp-auth";
import { AuditFilters, type ProjectOption } from "./_components/audit-filters";

export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("en-US");
const TIMESTAMP = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeStyle: "medium",
});

function formatTimestamp(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : TIMESTAMP.format(d);
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "success"
      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
      : status === "error"
        ? "border-red-500/30 bg-red-500/15 text-red-300"
        : "border-zinc-700 bg-zinc-900 text-zinc-400";
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}
    >
      {status}
    </span>
  );
}

function buildPageHref(currentParams: URLSearchParams, page: number): string {
  const params = new URLSearchParams(currentParams);
  if (page <= 1) params.delete("page");
  else params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/audit?${qs}` : "/audit";
}

interface PageProps {
  searchParams: Promise<{
    project?: string;
    operation?: string;
    status?: string;
    page?: string;
  }>;
}

export default async function AuditPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? "1", 10) || 1;
  const status = params.status === "success" || params.status === "error" ? params.status : undefined;

  const [projects, operations] = await Promise.all([
    getProjectsForUser(session.userId),
    getDistinctOperations(session.userId),
  ]);

  // Validate project filter belongs to this user (defense in depth — userId
  // already gates listInvocations, but a stale ID shouldn't silently pass).
  const projectOptions: ProjectOption[] = projects.map((p) => ({
    projectId: p.projectId,
    label: `${p.clientSlug}/${p.projectSlug}`,
  }));
  const validProjectId = projectOptions.some((p) => p.projectId === params.project)
    ? params.project
    : undefined;

  const result = await listInvocations(session.userId, {
    projectId: validProjectId,
    operation: params.operation || undefined,
    status,
    page,
  });

  const startRow = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const endRow = Math.min(result.page * result.pageSize, result.total);

  // Re-build searchParams object for pagination links (drop `page`).
  const linkParams = new URLSearchParams();
  if (validProjectId) linkParams.set("project", validProjectId);
  if (params.operation) linkParams.set("operation", params.operation);
  if (status) linkParams.set("status", status);

  return (
    <div className="px-8 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Audit trail</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Every MCP and webapp invocation, in reverse chronological order.
          </p>
        </div>
        <span className="text-xs text-zinc-500">
          {result.total === 0
            ? "No matching invocations"
            : `Showing ${NUMBER.format(startRow)}–${NUMBER.format(endRow)} of ${NUMBER.format(result.total)}`}
        </span>
      </header>

      <section className="mb-4">
        <AuditFilters projects={projectOptions} operations={operations} />
      </section>

      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
        {result.rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">
            Nothing matches the current filters.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800/70">
            {result.rows.map((r) => {
              const projectLabel = r.projectSlug
                ? `${r.clientSlug ?? "?"}/${r.projectSlug}`
                : "(no project)";
              const chunksJson = JSON.stringify(r.retrievedChunks ?? null, null, 2);
              const showChunks = chunksJson !== "null" && chunksJson !== "{}" && chunksJson !== "[]";
              return (
                <li key={r.id}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 text-sm hover:bg-zinc-900/40">
                      <StatusPill status={r.status} />
                      <span className="font-mono text-xs text-zinc-300">{r.operation}</span>
                      <span className="text-zinc-500">·</span>
                      <span className="font-mono text-xs text-zinc-400">{projectLabel}</span>
                      <span className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
                        {r.latencyMs !== null ? <span>{NUMBER.format(r.latencyMs)} ms</span> : null}
                        <span>{formatTimestamp(r.createdAt)}</span>
                        <span className="text-zinc-600 group-open:rotate-90 transition-transform">
                          ›
                        </span>
                      </span>
                    </summary>
                    <div className="space-y-3 border-t border-zinc-800/70 bg-zinc-950/60 px-5 py-4 text-xs">
                      {r.errorDetail ? (
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-red-400">
                            error
                          </p>
                          <pre className="mt-1 whitespace-pre-wrap font-mono text-red-300">
                            {r.errorDetail}
                          </pre>
                        </div>
                      ) : null}
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                          user_prompt
                        </p>
                        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-zinc-300">
                          {r.userPrompt || "(empty)"}
                        </pre>
                      </div>
                      {showChunks ? (
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                            retrieved_chunks
                          </p>
                          <pre className="mt-1 max-h-64 overflow-auto rounded bg-zinc-900 p-2 font-mono text-zinc-400">
                            {chunksJson}
                          </pre>
                        </div>
                      ) : null}
                      {r.responseText ? (
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                            response_text
                          </p>
                          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-zinc-300">
                            {r.responseText}
                          </pre>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1 text-zinc-500">
                        {r.provider !== "none" ? (
                          <span>
                            provider: <span className="text-zinc-300">{r.provider}</span>
                          </span>
                        ) : null}
                        {r.model !== "none" ? (
                          <span>
                            model: <span className="text-zinc-300">{r.model}</span>
                          </span>
                        ) : null}
                        {r.promptTokens !== null ? (
                          <span>
                            prompt tokens:{" "}
                            <span className="text-zinc-300 tabular-nums">
                              {NUMBER.format(r.promptTokens)}
                            </span>
                          </span>
                        ) : null}
                        {r.completionTokens !== null ? (
                          <span>
                            completion tokens:{" "}
                            <span className="text-zinc-300 tabular-nums">
                              {NUMBER.format(r.completionTokens)}
                            </span>
                          </span>
                        ) : null}
                        {r.costUsd ? (
                          <span>
                            cost: <span className="text-zinc-300">${r.costUsd}</span>
                          </span>
                        ) : null}
                        <span className="font-mono text-zinc-600">id: {r.id}</span>
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {result.totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-xs">
          <div className="text-zinc-500">
            Page {result.page} of {result.totalPages}
          </div>
          <div className="flex items-center gap-2">
            {result.page > 1 ? (
              <Link
                href={buildPageHref(linkParams, result.page - 1)}
                className="rounded-md border border-zinc-700 px-3 py-1 text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
              >
                ← Previous
              </Link>
            ) : (
              <span className="rounded-md border border-zinc-800 px-3 py-1 text-zinc-700">
                ← Previous
              </span>
            )}
            {result.page < result.totalPages ? (
              <Link
                href={buildPageHref(linkParams, result.page + 1)}
                className="rounded-md border border-zinc-700 px-3 py-1 text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
              >
                Next →
              </Link>
            ) : (
              <span className="rounded-md border border-zinc-800 px-3 py-1 text-zinc-700">
                Next →
              </span>
            )}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
