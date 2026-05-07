import Link from "next/link";
import type { ComposeContextResult } from "@/lib/compose";

const NUMBER = new Intl.NumberFormat("en-US");
const SCORE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3, minimumFractionDigits: 3 });

function MetaPill({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-md border px-2.5 py-1 text-[11px] ${
        accent
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          : "border-zinc-800 bg-zinc-950/50 text-zinc-300"
      }`}
    >
      <span className="text-zinc-500">{label}: </span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function CanonCard({
  label,
  body,
  defaultOpen,
}: {
  label: string;
  body: string | null;
  defaultOpen?: boolean;
}) {
  if (!body) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/20 p-4 text-xs text-zinc-500">
        <span className="font-mono uppercase">{label}</span>: not configured
      </div>
    );
  }
  return (
    <details className="group rounded-xl border border-zinc-800 bg-zinc-950/40" open={defaultOpen}>
      <summary className="flex cursor-pointer items-center justify-between px-4 py-2 text-sm">
        <span className="font-medium text-zinc-200">{label}</span>
        <span className="text-[11px] text-zinc-500 group-open:rotate-90 transition-transform">
          ›
        </span>
      </summary>
      <pre className="border-t border-zinc-800 px-4 py-3 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-zinc-300">
        {body}
      </pre>
    </details>
  );
}

export function ComposeResult({
  result,
  clientSlug,
  projectSlug,
}: {
  result: ComposeContextResult;
  clientSlug: string;
  projectSlug: string;
}) {
  const projectBase = `/projects/${clientSlug}/${projectSlug}`;
  const focus = result.focus;
  const linkedEntries = Object.entries(result.linked).filter(([, docs]) => docs.length > 0);

  return (
    <div className="space-y-6 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.02] p-6">
      {/* Metadata strip */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-emerald-300">
          Bundle ready
        </span>
        <MetaPill label="focus" value={result.metadata.focusReason} />
        <MetaPill
          label="rag chunks"
          value={NUMBER.format(result.metadata.chunksRetrieved)}
        />
        <MetaPill
          label="links"
          value={NUMBER.format(result.metadata.linksFollowed)}
        />
        <MetaPill
          label="rerank"
          value={result.metadata.rerankUsed ? "voyage rerank-2" : "off"}
          accent={result.metadata.rerankUsed}
        />
      </div>

      {/* Focus document */}
      {focus ? (
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Focus document
          </h2>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="flex items-center gap-2">
              <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-300">
                {focus.type}
              </span>
              {focus.externalId ? (
                <Link
                  href={`${projectBase}/${focus.externalId}`}
                  className="font-mono text-xs text-indigo-300 hover:text-indigo-200"
                >
                  {focus.externalId}
                </Link>
              ) : null}
              <Link
                href={`${projectBase}/${focus.externalId ?? focus.documentId}`}
                className="font-medium text-zinc-100 hover:text-indigo-200"
              >
                {focus.title}
              </Link>
            </div>
            <p className="mt-1 font-mono text-[11px] text-zinc-500">{focus.path}</p>
            {Object.keys(focus.frontmatter).length > 0 ? (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                  frontmatter ({Object.keys(focus.frontmatter).length} keys)
                </summary>
                <pre className="mt-2 overflow-auto rounded bg-zinc-900 p-2 font-mono text-[11px] text-zinc-400">
                  {JSON.stringify(focus.frontmatter, null, 2)}
                </pre>
              </details>
            ) : null}
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                content ({focus.content.length.toLocaleString()} chars)
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-900 p-3 font-mono text-[11px] text-zinc-300">
                {focus.content}
              </pre>
            </details>
          </div>
        </section>
      ) : null}

      {/* Canon */}
      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Canon
        </h2>
        <div className="space-y-2">
          <CanonCard label="conventions" body={result.canon.conventions} />
          <CanonCard label="guidelines" body={result.canon.guidelines} />
          <CanonCard label="architecture" body={result.canon.architecture} />
        </div>
      </section>

      {/* Linked documents */}
      {linkedEntries.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Linked documents
          </h2>
          <div className="space-y-3">
            {linkedEntries.map(([bucket, docs]) => (
              <div key={bucket} className="rounded-xl border border-zinc-800 bg-zinc-950/40">
                <header className="border-b border-zinc-800 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                  {bucket} · {docs.length}
                </header>
                <ul className="divide-y divide-zinc-800/70">
                  {docs.map((d) => {
                    const ref = d.externalId ?? d.documentId;
                    return (
                      <li key={d.documentId} className="px-4 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400">
                            {d.linkType}
                          </span>
                          {d.externalId ? (
                            <Link
                              href={`${projectBase}/${ref}`}
                              className="font-mono text-xs text-indigo-300 hover:text-indigo-200"
                            >
                              {d.externalId}
                            </Link>
                          ) : null}
                          <Link
                            href={`${projectBase}/${ref}`}
                            className="text-zinc-100 hover:text-indigo-200"
                          >
                            {d.title}
                          </Link>
                        </div>
                        {d.note ? (
                          <p className="mt-1 pl-2 text-[11px] italic text-zinc-500">
                            "{d.note}"
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* RAG chunks */}
      {result.ragChunks.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            RAG chunks ({result.ragChunks.length})
          </h2>
          <ul className="space-y-2">
            {result.ragChunks.map((chunk, idx) => {
              const ref = chunk.externalId ?? chunk.documentId;
              return (
                <li
                  key={`${chunk.documentId}-${idx}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3"
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
                        href={`${projectBase}/${ref}`}
                        className="font-mono text-xs text-indigo-300 hover:text-indigo-200"
                      >
                        {chunk.externalId}
                      </Link>
                    ) : null}
                    <Link
                      href={`${projectBase}/${ref}`}
                      className="text-sm text-zinc-100 hover:text-indigo-200"
                    >
                      {chunk.documentTitle}
                    </Link>
                    <span className="ml-auto flex items-center gap-3 text-[11px] tabular-nums text-zinc-500">
                      {chunk.rerankScore !== undefined ? (
                        <span title="rerank score">
                          rerank {SCORE.format(chunk.rerankScore)}
                        </span>
                      ) : null}
                      <span title="cosine similarity">
                        sim {SCORE.format(chunk.similarity)}
                      </span>
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-zinc-300">
                    {chunk.text}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Stakeholders */}
      {result.stakeholders.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Stakeholders ({result.stakeholders.length})
          </h2>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {result.stakeholders.map((s) => (
              <div
                key={s.name}
                className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3 text-xs"
              >
                <p className="font-medium text-zinc-100">{s.name}</p>
                {s.role ? <p className="text-zinc-400">{s.role}</p> : null}
                {s.communicationStyle ? (
                  <p className="mt-1 italic text-zinc-500">{s.communicationStyle}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Instructions for agent */}
      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Instructions for agent
        </h2>
        <details className="rounded-xl border border-zinc-800 bg-zinc-950/40">
          <summary className="cursor-pointer px-4 py-2 text-sm text-zinc-300 hover:text-zinc-100">
            Show the system prompt that would be injected
            <span className="ml-2 text-[11px] text-zinc-500">
              ({result.instructionsForAgent.length.toLocaleString()} chars)
            </span>
          </summary>
          <pre className="border-t border-zinc-800 px-4 py-3 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-zinc-300">
            {result.instructionsForAgent}
          </pre>
        </details>
      </section>
    </div>
  );
}
