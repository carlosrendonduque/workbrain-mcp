import Link from "next/link";
import { requireSession } from "@/lib/webapp-auth";
import {
  getOperationBreakdownLast7d,
  getOverviewStats,
  getProjectsForUser,
  getRecentInvocations,
} from "@/lib/stats";

export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("en-US");
const PERCENT = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

function formatRelative(value: Date | string | null): string {
  if (!value) return "never";
  const ts = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(ts)) return "never";
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-100 tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === "success"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : status === "error"
        ? "bg-red-500/15 text-red-300 border-red-500/30"
        : "bg-zinc-800 text-zinc-400 border-zinc-700";
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${color}`}
    >
      {status}
    </span>
  );
}

export default async function DashboardPage() {
  const session = await requireSession();

  const [overview, projects, recent, ops] = await Promise.all([
    getOverviewStats(session.userId),
    getProjectsForUser(session.userId),
    getRecentInvocations(session.userId, 12),
    getOperationBreakdownLast7d(session.userId),
  ]);

  const successRateLabel =
    overview.successRateLast7d === null ? "—" : PERCENT.format(overview.successRateLast7d);

  return (
    <div className="px-8 py-8">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Overview across all clients and projects you own.
          </p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Projects"
          value={NUMBER.format(overview.projectCount)}
          hint={`${NUMBER.format(overview.clientCount)} client${overview.clientCount === 1 ? "" : "s"}`}
        />
        <StatCard label="Documents" value={NUMBER.format(overview.documentCount)} />
        <StatCard label="Chunks" value={NUMBER.format(overview.chunkCount)} />
        <StatCard
          label="Invocations · 7d"
          value={NUMBER.format(overview.invocationsLast7d)}
          hint={`${successRateLabel} success · ${NUMBER.format(overview.invocationsAllTime)} all-time`}
        />
      </section>

      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-950/40">
          <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
            <h2 className="text-sm font-medium text-zinc-200">Projects</h2>
            <span className="text-xs text-zinc-500">
              {NUMBER.format(projects.length)} total
            </span>
          </header>
          {projects.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-500">
              No projects yet. Seed with{" "}
              <code className="font-mono text-zinc-300">pnpm db:seed:projects</code>.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-5 py-2 text-left font-medium">Project</th>
                  <th className="px-5 py-2 text-right font-medium">Docs</th>
                  <th className="px-5 py-2 text-right font-medium">Chunks</th>
                  <th className="px-5 py-2 text-right font-medium">Last invocation</th>
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
                          {p.persist ? "" : " · ephemeral"}
                        </div>
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-zinc-300">
                      {NUMBER.format(p.documentCount)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-zinc-300">
                      {NUMBER.format(p.chunkCount)}
                    </td>
                    <td className="px-5 py-3 text-right text-xs text-zinc-400">
                      {formatRelative(p.lastInvocationAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40">
          <header className="border-b border-zinc-800 px-5 py-3">
            <h2 className="text-sm font-medium text-zinc-200">Operations · 7d</h2>
          </header>
          {ops.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-500">No invocations in the last 7 days.</p>
          ) : (
            <ul className="divide-y divide-zinc-800/70">
              {ops.map((op) => (
                <li
                  key={op.operation}
                  className="flex items-center justify-between px-5 py-2.5 text-sm"
                >
                  <span className="font-mono text-xs text-zinc-300">{op.operation}</span>
                  <span className="tabular-nums text-zinc-400">{NUMBER.format(op.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950/40">
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-medium text-zinc-200">Recent invocations</h2>
          <span className="text-xs text-zinc-500">last {recent.length}</span>
        </header>
        {recent.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-500">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-800/70">
            {recent.map((r) => (
              <li key={r.id} className="px-5 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <StatusPill status={r.status} />
                  <span className="font-mono text-xs text-zinc-300">{r.operation}</span>
                  <span className="text-zinc-500">·</span>
                  <span className="text-zinc-400">
                    {r.projectSlug ? r.projectSlug : "(no project)"}
                  </span>
                  <span className="ml-auto text-xs text-zinc-500">
                    {r.latencyMs !== null ? `${NUMBER.format(r.latencyMs)} ms · ` : ""}
                    {formatRelative(r.createdAt)}
                  </span>
                </div>
                {r.errorDetail ? (
                  <p className="mt-1 truncate font-mono text-xs text-red-400">{r.errorDetail}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
