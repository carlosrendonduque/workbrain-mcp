import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ARCHIVED_STATUS } from "@/lib/curation";
import { db, schema } from "@/lib/db";
import { getDocumentDetail, getDocumentLinks, type DocumentLink } from "@/lib/documents";
import { requireSession } from "@/lib/webapp-auth";
import { type CandidateDoc, CurationPanel } from "./_components/curation-panel";

export const dynamic = "force-dynamic";

const TIMESTAMP = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : TIMESTAMP.format(d);
}

function renderFrontmatterValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function LinksList({
  title,
  links,
  basePath,
  emptyHint,
  arrow,
}: {
  title: string;
  links: DocumentLink[];
  basePath: string;
  emptyHint: string;
  arrow: "→" | "←";
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <h2 className="text-sm font-medium text-zinc-200">{title}</h2>
        <span className="text-xs text-zinc-500">{links.length}</span>
      </header>
      {links.length === 0 ? (
        <p className="px-4 py-4 text-xs text-zinc-500">{emptyHint}</p>
      ) : (
        <ul className="divide-y divide-zinc-800/70">
          {links.map((link) => {
            const ref = link.externalId ?? link.documentId;
            return (
              <li key={link.linkId} className="px-4 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">{arrow}</span>
                  <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-300">
                    {link.linkType}
                  </span>
                  <Link
                    href={`${basePath}/${ref}`}
                    className="font-mono text-xs text-indigo-300 hover:text-indigo-200"
                  >
                    {link.externalId ?? link.documentId.slice(0, 8)}
                  </Link>
                  <span className="truncate text-zinc-100">{link.title}</span>
                </div>
                {link.note ? (
                  <p className="mt-1 pl-6 text-xs italic text-zinc-400">"{link.note}"</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface PageProps {
  params: Promise<{ clientSlug: string; projectSlug: string; ref: string }>;
}

async function listLinkCandidates(
  projectId: string,
  excludeDocumentId: string,
): Promise<CandidateDoc[]> {
  const rows = await db
    .select({
      externalId: schema.documents.externalId,
      type: schema.documents.type,
      title: schema.documents.title,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.projectId, projectId),
        isNotNull(schema.documents.externalId),
        ne(schema.documents.id, excludeDocumentId),
      ),
    )
    .orderBy(desc(schema.documents.createdAt))
    .limit(500);
  return rows.filter(
    (r): r is { externalId: string; type: string; title: string } => r.externalId !== null,
  );
}

export default async function DocumentDetailPage({ params }: PageProps) {
  const session = await requireSession();
  const { clientSlug, projectSlug, ref } = await params;

  const doc = await getDocumentDetail(session.userId, clientSlug, projectSlug, ref);
  if (!doc) notFound();

  const [links, candidates] = await Promise.all([
    getDocumentLinks(doc.documentId),
    listLinkCandidates(doc.projectId, doc.documentId),
  ]);

  const projectBasePath = `/projects/${clientSlug}/${projectSlug}`;
  const frontmatterEntries = Object.entries(doc.frontmatter);
  const isArchived = doc.status === ARCHIVED_STATUS;

  return (
    <div className="px-8 py-8">
      <nav className="mb-2 text-xs text-zinc-500">
        <Link href="/projects" className="hover:text-zinc-300">
          Corpus
        </Link>
        <span className="mx-2">/</span>
        <span className="font-mono">{doc.clientSlug}</span>
        <span className="mx-2">/</span>
        <Link href={projectBasePath} className="font-mono hover:text-zinc-300">
          {doc.projectSlug}
        </Link>
        <span className="mx-2">/</span>
        <span className="font-mono text-zinc-300">
          {doc.externalId ?? doc.documentId.slice(0, 8)}
        </span>
      </nav>

      <header className="mb-6">
        <div className="flex items-center gap-2">
          <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-300">
            {doc.type}
          </span>
          {doc.externalId ? (
            <span className="font-mono text-sm text-indigo-300">{doc.externalId}</span>
          ) : null}
          {doc.status ? (
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                isArchived
                  ? "border-amber-500/30 bg-amber-500/15 text-amber-300"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400"
              }`}
            >
              {doc.status}
            </span>
          ) : null}
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100">{doc.title}</h1>
        <p className="mt-2 font-mono text-xs text-zinc-500">{doc.path}</p>
        <p className="mt-1 text-xs text-zinc-500">
          Created {formatTimestamp(doc.createdAt)} · Updated {formatTimestamp(doc.updatedAt)}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-6">
          {frontmatterEntries.length > 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40">
              <header className="border-b border-zinc-800 px-4 py-2.5">
                <h2 className="text-sm font-medium text-zinc-200">Frontmatter</h2>
              </header>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-zinc-800/70">
                  {frontmatterEntries.map(([key, value]) => (
                    <tr key={key}>
                      <td className="w-40 px-4 py-2 align-top font-mono text-zinc-500">{key}</td>
                      <td className="px-4 py-2 font-mono text-zinc-300 break-all">
                        {renderFrontmatterValue(value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40">
            <header className="border-b border-zinc-800 px-4 py-2.5">
              <h2 className="text-sm font-medium text-zinc-200">Content</h2>
            </header>
            <pre className="overflow-auto whitespace-pre-wrap break-words px-4 py-4 font-mono text-xs leading-relaxed text-zinc-200">
              {doc.content}
            </pre>
          </div>
        </section>

        <aside className="space-y-6">
          <LinksList
            title="Outgoing links"
            links={links.outgoing}
            basePath={projectBasePath}
            emptyHint="This document doesn't reference any other document."
            arrow="→"
          />
          <LinksList
            title="Incoming links"
            links={links.incoming}
            basePath={projectBasePath}
            emptyHint="No documents reference this one."
            arrow="←"
          />
          <CurationPanel
            clientSlug={clientSlug}
            projectSlug={projectSlug}
            documentRef={ref}
            thisDocPath={doc.path}
            documentId={doc.documentId}
            thisDocExternalId={doc.externalId}
            isArchived={isArchived}
            candidates={candidates}
          />
        </aside>
      </div>
    </div>
  );
}
