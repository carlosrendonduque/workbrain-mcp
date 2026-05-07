import Link from "next/link";
import { type DraftRow, listDrafts } from "@/lib/drafts";
import { requireSession } from "@/lib/webapp-auth";

export const dynamic = "force-dynamic";

const TIMESTAMP = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(value: Date | string | null): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : TIMESTAMP.format(d);
}

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

const STATUS_FILTERS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
] as const;

export default async function GlobalDraftsPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const sp = await searchParams;
  const requestedStatus =
    sp.status === "approved" || sp.status === "rejected" || sp.status === "pending" || sp.status === "all"
      ? sp.status
      : "pending";
  const statusFilter = requestedStatus === "all" ? undefined : requestedStatus;

  const drafts = await listDrafts(session.userId, { status: statusFilter });

  // Group by project for clarity.
  const byProject = new Map<string, { projectSlug: string; projectName: string; clientSlug: string; rows: DraftRow[] }>();
  for (const d of drafts) {
    const key = `${d.clientSlug}/${d.projectSlug}`;
    const bucket = byProject.get(key);
    if (bucket) {
      bucket.rows.push(d);
    } else {
      byProject.set(key, {
        projectSlug: d.projectSlug,
        projectName: d.projectName,
        clientSlug: d.clientSlug,
        rows: [d],
      });
    }
  }

  return (
    <div className="px-8 py-8">
      <header className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-100">Drafts</h1>
        <p className="mt-1 text-sm text-zinc-400">
          All proposals from agent conversations across every project. Drafts don't
          enter the corpus until you approve them. Click a project to review
          individually with edit + approve / reject.
        </p>
      </header>

      <section className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-zinc-500">filter:</span>
        {STATUS_FILTERS.map((f) => {
          const active = requestedStatus === f.value;
          const href = f.value === "pending" ? "/drafts" : `/drafts?status=${f.value}`;
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

      {byProject.size === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-500">
          {requestedStatus === "pending"
            ? "No pending drafts. Drafts appear here when the agent proposes content during conversations."
            : `No ${requestedStatus} drafts.`}
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(byProject.values()).map((bucket) => {
            const projectBase = `/projects/${bucket.clientSlug}/${bucket.projectSlug}`;
            return (
              <div
                key={`${bucket.clientSlug}/${bucket.projectSlug}`}
                className="rounded-xl border border-zinc-800 bg-zinc-950/40"
              >
                <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
                  <div>
                    <Link
                      href={`${projectBase}/drafts`}
                      className="text-sm font-medium text-zinc-100 hover:text-indigo-200"
                    >
                      {bucket.projectName}
                    </Link>
                    <p className="font-mono text-xs text-zinc-500">
                      {bucket.clientSlug}/{bucket.projectSlug}
                    </p>
                  </div>
                  <Link
                    href={`${projectBase}/drafts`}
                    className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
                  >
                    Review →
                  </Link>
                </header>
                <ul className="divide-y divide-zinc-800/70">
                  {bucket.rows.map((d) => (
                    <li key={d.draftId} className="px-5 py-2.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-300">
                          {d.proposedType}
                        </span>
                        {d.proposedExternalId ? (
                          <span className="font-mono text-xs text-indigo-300">
                            {d.proposedExternalId}
                          </span>
                        ) : null}
                        <span className="text-zinc-100">{d.proposedTitle}</span>
                        <span className="ml-auto text-[11px] text-zinc-500">
                          {formatTimestamp(d.createdAt)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
