import Link from "next/link";
import { notFound } from "next/navigation";
import { getDraftTypeCounts, listDrafts } from "@/lib/drafts";
import { getProjectByPath } from "@/lib/projects";
import { requireSession } from "@/lib/webapp-auth";
import { DraftsList } from "./_components/drafts-list";

export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("en-US");

interface PageProps {
  params: Promise<{ clientSlug: string; projectSlug: string }>;
  searchParams: Promise<{ status?: string; type?: string; q?: string }>;
}

const STATUS_FILTERS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
] as const;

function buildHref(
  basePath: string,
  current: { status: string; type?: string; q?: string },
  patch: { status?: string; type?: string | null; q?: string | null },
): string {
  const params = new URLSearchParams();
  const status = patch.status ?? current.status;
  const type = patch.type === null ? undefined : (patch.type ?? current.type);
  const q = patch.q === null ? undefined : (patch.q ?? current.q);
  if (status && status !== "pending") params.set("status", status);
  if (type) params.set("type", type);
  if (q) params.set("q", q);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export default async function DraftsPage({ params, searchParams }: PageProps) {
  const session = await requireSession();
  const { clientSlug, projectSlug } = await params;
  const sp = await searchParams;

  const project = await getProjectByPath(session.userId, clientSlug, projectSlug);
  if (!project) notFound();

  const projectBasePath = `/projects/${clientSlug}/${projectSlug}`;
  const draftsBasePath = `${projectBasePath}/drafts`;
  const requestedStatus =
    sp.status === "approved" ||
    sp.status === "rejected" ||
    sp.status === "pending" ||
    sp.status === "all"
      ? sp.status
      : "pending";
  const statusFilter = requestedStatus === "all" ? undefined : requestedStatus;
  const typeFilter = sp.type && sp.type.length > 0 ? sp.type : undefined;
  const queryFilter = sp.q && sp.q.length > 0 ? sp.q : undefined;

  const [drafts, typeCounts] = await Promise.all([
    listDrafts(session.userId, null, {
      projectSlug,
      status: statusFilter,
      type: typeFilter,
      query: queryFilter,
    }),
    getDraftTypeCounts(session.userId, null, { projectSlug, status: statusFilter }),
  ]);

  const totalForStatus = typeCounts.reduce((acc, t) => acc + t.count, 0);
  const currentParams = { status: requestedStatus, type: typeFilter, q: queryFilter };

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
        <h1 className="text-2xl font-semibold text-zinc-100">{project.projectName} · drafts</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Documents the agent proposed during conversations. Nothing here is in the corpus yet —
          review, approve or discard. Approved drafts run through the normal ingest pipeline
          (chunking, embedding, auto-linking) and become real documents.
        </p>
      </header>

      <section className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-zinc-500">status:</span>
        {STATUS_FILTERS.map((f) => {
          const active = requestedStatus === f.value;
          return (
            <Link
              key={f.value}
              href={buildHref(draftsBasePath, currentParams, {
                status: f.value,
                type: null,
                q: null,
              })}
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

      <section className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={buildHref(draftsBasePath, currentParams, { type: null })}
          className={`rounded-full px-3 py-1 text-xs ${
            !typeFilter
              ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/40"
              : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          All · {NUMBER.format(totalForStatus)}
        </Link>
        {typeCounts.map((t) => {
          const active = typeFilter === t.type;
          return (
            <Link
              key={t.type}
              href={buildHref(draftsBasePath, currentParams, { type: t.type })}
              className={`rounded-full px-3 py-1 text-xs ${
                active
                  ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/40"
                  : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {t.type} · {NUMBER.format(t.count)}
            </Link>
          );
        })}

        <form action={draftsBasePath} method="get" className="ml-auto flex items-center gap-1">
          {requestedStatus !== "pending" ? (
            <input type="hidden" name="status" value={requestedStatus} />
          ) : null}
          {typeFilter ? <input type="hidden" name="type" value={typeFilter} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={queryFilter ?? ""}
            placeholder="title, external_id, content…"
            className="w-64 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
          />
          {queryFilter ? (
            <Link
              href={buildHref(draftsBasePath, currentParams, { q: null })}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              clear
            </Link>
          ) : null}
        </form>
      </section>

      {drafts.length > 0 ? (
        <p className="mb-2 text-[11px] text-zinc-500">
          Showing {NUMBER.format(drafts.length)}
          {drafts.length === 100 ? " (capped — narrow with filters)" : ""}.
        </p>
      ) : null}

      <DraftsList
        drafts={drafts}
        clientSlug={clientSlug}
        projectSlug={projectSlug}
        projectBasePath={projectBasePath}
      />
    </div>
  );
}
