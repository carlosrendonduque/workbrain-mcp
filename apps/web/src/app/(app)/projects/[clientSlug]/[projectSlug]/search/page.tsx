import Link from "next/link";
import { notFound } from "next/navigation";
import { getProjectByPath, getTypeCountsForProject } from "@/lib/projects";
import { SearchError, search } from "@/lib/search";
import { corpusDbFor } from "@/lib/db";
import { requireSession } from "@/lib/webapp-auth";

export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("en-US");
const SCORE = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 3,
  minimumFractionDigits: 3,
});

interface PageProps {
  params: Promise<{ clientSlug: string; projectSlug: string }>;
  searchParams: Promise<{ q?: string; types?: string; norerank?: string }>;
}

function buildHref(
  basePath: string,
  current: { q?: string; types?: string[]; norerank?: boolean },
  patch: { q?: string | null; types?: string[] | null; norerank?: boolean | null },
): string {
  const params = new URLSearchParams();
  const q = patch.q === null ? undefined : (patch.q ?? current.q);
  const types = patch.types === null ? undefined : (patch.types ?? current.types);
  const norerank = patch.norerank === null ? undefined : (patch.norerank ?? current.norerank);
  if (q) params.set("q", q);
  if (types && types.length > 0) params.set("types", types.join(","));
  if (norerank) params.set("norerank", "1");
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export default async function SearchPage({ params, searchParams }: PageProps) {
  const session = await requireSession();
  const { clientSlug, projectSlug } = await params;
  const sp = await searchParams;
  const project = await getProjectByPath(session.userId, clientSlug, projectSlug);
  if (!project) notFound();

  const projectBasePath = `/projects/${clientSlug}/${projectSlug}`;
  const searchPath = `${projectBasePath}/search`;

  const query = sp.q?.trim();
  const activeTypes = sp.types
    ? sp.types
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const useRerank = sp.norerank !== "1";

  const typeCounts = await getTypeCountsForProject(corpusDbFor(project), project.projectId);

  let resultErr: string | null = null;
  let result: Awaited<ReturnType<typeof search>> | null = null;
  if (query) {
    try {
      result = await search(
        session.userId,
        {
          query,
          projectSlug,
          types: activeTypes.length > 0 ? activeTypes : undefined,
          useRerank,
        },
        { sessionId: null, clientScope: null },
      );
    } catch (err) {
      if (err instanceof SearchError) {
        resultErr = err.message;
      } else {
        resultErr = err instanceof Error ? err.message : String(err);
      }
    }
  }

  return (
    <div className="px-8 py-8">
      <nav className="mb-2 text-xs text-zinc-500">
        <Link href="/projects" className="hover:text-zinc-300">
          Corpus
        </Link>
        <span className="mx-2">/</span>
        <span className="font-mono">{project.clientSlug}</span>
        <span className="mx-2">/</span>
        <Link href={projectBasePath} className="font-mono hover:text-zinc-300">
          {project.projectSlug}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-300">search</span>
      </nav>

      <header className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-100">Semantic search</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Query the project corpus by meaning (voyage-3-large embeddings + rerank-2). For
          metadata-only search (title / external_id / path), use the corpus browser search box.
        </p>
      </header>

      <form method="get" action={searchPath} className="mb-4 flex flex-wrap items-center gap-2">
        {activeTypes.length > 0 ? (
          <input type="hidden" name="types" value={activeTypes.join(",")} />
        ) : null}
        {!useRerank ? <input type="hidden" name="norerank" value="1" /> : null}
        <input
          type="search"
          name="q"
          defaultValue={query ?? ""}
          placeholder="What are you looking for?"
          // biome-ignore lint/a11y/noAutofocus: this page exists to be typed into; focusing its single input is what a user expects
          autoFocus
          className="flex-1 min-w-[12rem] rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          Search
        </button>
      </form>

      <section className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-zinc-500">filter type:</span>
        <Link
          href={buildHref(
            searchPath,
            { q: query, types: activeTypes, norerank: !useRerank },
            { types: null },
          )}
          className={`rounded-full px-3 py-1 text-xs ${
            activeTypes.length === 0
              ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/40"
              : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          all
        </Link>
        {typeCounts.map((tc) => {
          const isActive = activeTypes.includes(tc.type);
          const nextTypes = isActive
            ? activeTypes.filter((t) => t !== tc.type)
            : [...activeTypes, tc.type];
          return (
            <Link
              key={tc.type}
              href={buildHref(
                searchPath,
                { q: query, types: activeTypes, norerank: !useRerank },
                { types: nextTypes.length > 0 ? nextTypes : null },
              )}
              className={`rounded-full px-3 py-1 text-xs ${
                isActive
                  ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/40"
                  : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {tc.type} · {NUMBER.format(tc.count)}
            </Link>
          );
        })}
        <span className="ml-auto text-xs text-zinc-500">
          rerank:{" "}
          <Link
            href={buildHref(
              searchPath,
              { q: query, types: activeTypes, norerank: !useRerank },
              { norerank: useRerank ? true : null },
            )}
            className={useRerank ? "text-emerald-300" : "text-zinc-400 hover:text-zinc-200"}
          >
            {useRerank ? "on" : "off"}
          </Link>
        </span>
      </section>

      {!query ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-500">
          Enter a query above to search this project's corpus.
        </div>
      ) : resultErr ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <p className="font-medium">Search failed</p>
          <p className="mt-1 text-xs">{resultErr}</p>
        </div>
      ) : result && result.chunks.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-500">
          No chunks above the similarity threshold for "{query}".
        </div>
      ) : result ? (
        <section>
          <p className="mb-3 text-xs text-zinc-500">
            {result.chunks.length} chunk{result.chunks.length === 1 ? "" : "s"} ·{" "}
            {result.reranked ? "reranked by voyage rerank-2" : "cosine only"}
            {result.rerankCostUsd ? ` · cost $${result.rerankCostUsd}` : ""}
          </p>
          <ul className="space-y-3">
            {result.chunks.map((chunk, idx) => {
              const ref = chunk.externalId ?? chunk.documentId;
              return (
                <li
                  key={chunk.chunkId}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-indigo-300">
                      #{idx + 1}
                    </span>
                    <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-300">
                      {chunk.type}
                    </span>
                    {chunk.externalId ? (
                      <Link
                        href={`${projectBasePath}/${ref}`}
                        className="font-mono text-xs text-indigo-300 hover:text-indigo-200"
                      >
                        {chunk.externalId}
                      </Link>
                    ) : null}
                    <Link
                      href={`${projectBasePath}/${ref}`}
                      className="font-medium text-zinc-100 hover:text-indigo-200"
                    >
                      {chunk.documentTitle}
                    </Link>
                    <span className="ml-auto flex items-center gap-3 text-[11px] tabular-nums text-zinc-500">
                      {chunk.rerankScore !== undefined ? (
                        <span title="rerank score (voyage rerank-2)">
                          rerank {SCORE.format(chunk.rerankScore)}
                        </span>
                      ) : null}
                      <span title="cosine similarity">sim {SCORE.format(chunk.similarity)}</span>
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs text-zinc-300">
                    {chunk.text}
                  </p>
                  <p className="mt-2 font-mono text-[11px] text-zinc-500">{chunk.documentPath}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
