import Link from "next/link";
import { notFound } from "next/navigation";
import { listDrafts } from "@/lib/drafts";
import { corpusDbFor } from "@/lib/db";
import { requireSession } from "@/lib/webapp-auth";
import { getProjectByPath, getTypeCountsForProject, listDocumentsForProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("en-US");

function formatRelative(value: Date | string | null): string {
  if (!value) return "—";
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
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

function CanonPill({ label, present }: { label: string; present: boolean }) {
  const cls = present
    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
    : "border-zinc-700 bg-zinc-900 text-zinc-500";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

function buildHref(
  basePath: string,
  current: { type?: string; q?: string },
  patch: { type?: string | null; q?: string | null },
): string {
  const params = new URLSearchParams();
  const type = patch.type === null ? undefined : (patch.type ?? current.type);
  const q = patch.q === null ? undefined : (patch.q ?? current.q);
  if (type) params.set("type", type);
  if (q) params.set("q", q);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

interface PageProps {
  params: Promise<{ clientSlug: string; projectSlug: string }>;
  searchParams: Promise<{ type?: string; q?: string }>;
}

export default async function ProjectCorpusPage({ params, searchParams }: PageProps) {
  const session = await requireSession();
  const { clientSlug, projectSlug } = await params;
  const { type, q } = await searchParams;

  const project = await getProjectByPath(session.userId, clientSlug, projectSlug);
  if (!project) notFound();

  // Documents for this project live in its client's database.
  const corpusDb = corpusDbFor(project);

  const [types, docs, pendingDrafts] = await Promise.all([
    getTypeCountsForProject(corpusDb, project.projectId),
    listDocumentsForProject(corpusDb, project.projectId, { type, query: q }),
    listDrafts(session.userId, null, { projectSlug, status: "pending" }),
  ]);
  const pendingDraftsCount = pendingDrafts.length;

  const basePath = `/projects/${clientSlug}/${projectSlug}`;

  return (
    <div className="px-8 py-8">
      <nav className="mb-2 text-xs text-zinc-500">
        <Link href="/projects" className="hover:text-zinc-300">
          Corpus
        </Link>
        <span className="mx-2">/</span>
        <span className="font-mono">{project.clientSlug}</span>
        <span className="mx-2">/</span>
        <span className="font-mono text-zinc-300">{project.projectSlug}</span>
      </nav>

      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">{project.projectName}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {project.clientName} · {NUMBER.format(project.documentCount)} documents ·{" "}
            {NUMBER.format(project.chunkCount)} chunks
          </p>
          {project.repoUrl ? (
            <p className="mt-1 font-mono text-[11px] text-zinc-500">
              repo: {project.repoUrl}
              {project.defaultBranch ? ` · default: ${project.defaultBranch}` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <Link
              href={`${basePath}/search`}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
            >
              Search
            </Link>
            <Link
              href={`${basePath}/activity`}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
            >
              Activity
            </Link>
            <Link
              href={`${basePath}/drafts`}
              className="relative rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
            >
              Drafts
              {pendingDraftsCount > 0 ? (
                <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-amber-400/40">
                  {pendingDraftsCount}
                </span>
              ) : null}
            </Link>
            <Link
              href={`${basePath}/ingest`}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
            >
              + New document
            </Link>
            <Link
              href={`${basePath}/compose`}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500"
            >
              Compose context
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <CanonPill label="conventions" present={Boolean(project.conventions)} />
              <CanonPill label="guidelines" present={Boolean(project.guidelines)} />
              <CanonPill label="architecture" present={Boolean(project.architecture)} />
              {project.persist ? null : <CanonPill label="ephemeral" present={false} />}
            </div>
            <Link
              href={`${basePath}/canon`}
              className="text-[11px] text-zinc-500 underline-offset-2 hover:text-zinc-200 hover:underline"
            >
              edit
            </Link>
          </div>
          <div className="flex items-center gap-1.5">
            {project.domainSlug ? (
              <Link
                href={`/account/canons/${project.domainSlug}`}
                className="rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-indigo-300 transition hover:border-indigo-400/60"
                title={`Inherits canon from "${project.domainName}"`}
              >
                domain · {project.domainSlug}
              </Link>
            ) : (
              <Link
                href={`${basePath}/canon`}
                className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300 transition hover:border-amber-400/60"
                title="Assign a canon domain so the agent inherits cross-project conventions"
              >
                ⚠ no domain — assign
              </Link>
            )}
          </div>
        </div>
      </header>

      <section className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={buildHref(basePath, { type, q }, { type: null })}
          className={`rounded-full px-3 py-1 text-xs ${
            !type
              ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/40"
              : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          All · {NUMBER.format(project.documentCount)}
        </Link>
        {types.map((t) => {
          const active = type === t.type;
          return (
            <Link
              key={t.type}
              href={buildHref(basePath, { type, q }, { type: t.type })}
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

        <form action={basePath} method="get" className="ml-auto flex items-center gap-1">
          {type ? <input type="hidden" name="type" value={type} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="title, external_id, path…"
            className="w-64 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
          />
          {q ? (
            <Link
              href={buildHref(basePath, { type, q }, { q: null })}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              clear
            </Link>
          ) : null}
        </form>
      </section>

      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
        {docs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-500">
            {q || type ? "No documents match this filter." : "This project has no documents yet."}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800/70">
            {docs.map((d) => {
              const ref = d.externalId ?? d.documentId;
              return (
                <li key={d.documentId} className="group px-5 py-3 hover:bg-zinc-900/40">
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-300">
                      {d.type}
                    </span>
                    {d.externalId ? (
                      <Link
                        href={`${basePath}/${ref}`}
                        className="font-mono text-xs text-indigo-300 hover:text-indigo-200"
                      >
                        {d.externalId}
                      </Link>
                    ) : null}
                    <Link
                      href={`${basePath}/${ref}`}
                      className="font-medium text-zinc-100 group-hover:text-indigo-200"
                    >
                      {d.title}
                    </Link>
                    <span className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
                      {d.progressPattern ? (
                        <span
                          title="progress pattern: A·D·B·T·Dep"
                          className="font-mono text-[10px] text-zinc-500"
                        >
                          {d.progressPattern}
                        </span>
                      ) : null}
                      {d.outgoingLinkCount > 0 || d.incomingLinkCount > 0 ? (
                        <span title="outgoing → · incoming ←">
                          {d.outgoingLinkCount}→ · ←{d.incomingLinkCount}
                        </span>
                      ) : null}
                      <span>{formatRelative(d.createdAt)}</span>
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                    <span className="font-mono">{d.path}</span>
                    {d.status ? <span className="text-zinc-400">· {d.status}</span> : null}
                  </div>
                  {d.contentSnippet ? (
                    <p className="mt-1.5 line-clamp-2 text-xs text-zinc-400">{d.contentSnippet}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
