"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type IngestActionState, ingestPasteAction } from "../actions";

const DOCUMENT_TYPE_OPTIONS = [
  { value: "", label: "auto-detect (classifier)" },
  { value: "ticket", label: "ticket" },
  { value: "decision", label: "decision" },
  { value: "confluence", label: "confluence" },
  { value: "teams_thread", label: "teams thread" },
  { value: "email", label: "email" },
  { value: "transcript", label: "transcript" },
  { value: "convention", label: "convention" },
  { value: "guideline", label: "guideline" },
  { value: "stakeholder", label: "stakeholder" },
  { value: "task", label: "task" },
  { value: "note", label: "note" },
] as const;

const STATUS_OPTIONS = [
  { value: "", label: "—" },
  { value: "open", label: "open" },
  { value: "in_progress", label: "in_progress" },
  { value: "resolved", label: "resolved" },
] as const;

const initialState: IngestActionState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Ingesting…" : "Ingest document"}
    </button>
  );
}

export function PasteForm({
  clientSlug,
  projectSlug,
}: {
  clientSlug: string;
  projectSlug: string;
}) {
  const [state, formAction] = useActionState(ingestPasteAction, initialState);

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="clientSlug" value={clientSlug} />
        <input type="hidden" name="projectSlug" value={projectSlug} />

        <div>
          <label
            htmlFor="title"
            className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
          >
            Title <span className="text-red-400">*</span>
          </label>
          <input
            id="title"
            name="title"
            required
            placeholder="e.g. Renewal flow breaks on Opportunity stage change"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label
            htmlFor="content"
            className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
          >
            Content <span className="text-red-400">*</span>
          </label>
          <textarea
            id="content"
            name="content"
            required
            rows={14}
            placeholder="Paste the ticket / email / decision / note here. The classifier will infer type and references."
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label
              htmlFor="type"
              className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              Type
            </label>
            <select
              id="type"
              name="type"
              defaultValue=""
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            >
              {DOCUMENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-zinc-500">Skip to let Sonnet 4.6 classify.</p>
          </div>

          <div>
            <label
              htmlFor="externalId"
              className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              External ID
            </label>
            <input
              id="externalId"
              name="externalId"
              placeholder="TICKET-9001"
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
            />
            <p className="mt-1 text-[11px] text-zinc-500">Skip to let the classifier extract.</p>
          </div>

          <div>
            <label
              htmlFor="status"
              className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue=""
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <SubmitButton />
        </div>
      </form>

      {state.status === "error" ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <p className="font-medium">Ingest failed</p>
          <p className="mt-1 text-xs text-red-300">{state.message}</p>
          {state.code ? (
            <p className="mt-1 font-mono text-[11px] text-red-400/70">code: {state.code}</p>
          ) : null}
        </div>
      ) : null}

      {state.status === "success" ? (
        <IngestResult state={state} />
      ) : null}
    </div>
  );
}

function IngestResult({
  state,
}: {
  state: Extract<IngestActionState, { status: "success" }>;
}) {
  const { result, clientSlug, projectSlug } = state;
  const ref = result.inferredExternalId ?? result.documentId;
  const detailHref = `/projects/${clientSlug}/${projectSlug}/${ref}`;

  return (
    <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-zinc-200">
      <div className="flex items-center justify-between">
        <p className="font-medium text-emerald-300">Document ingested</p>
        <Link
          href={detailHref}
          className="text-xs text-indigo-300 hover:text-indigo-200"
        >
          Open document →
        </Link>
      </div>

      <div className="space-y-1 text-xs">
        <p>
          <span className="text-zinc-500">Path: </span>
          <span className="font-mono text-zinc-300">{result.path}</span>
        </p>
        <p>
          <span className="text-zinc-500">Chunks: </span>
          <span className="text-zinc-300">{result.chunkCount}</span>
        </p>
        {result.classified ? (
          <p>
            <span className="text-zinc-500">Classifier: </span>
            <span className="text-zinc-300">
              type={result.inferredType}
              {result.inferredExternalId ? `, externalId=${result.inferredExternalId}` : ""}
              {result.inferredDate ? `, date=${result.inferredDate}` : ""}
            </span>
            {result.classifierCostUsd ? (
              <span className="ml-2 font-mono text-[11px] text-zinc-500">
                (${result.classifierCostUsd})
              </span>
            ) : null}
          </p>
        ) : null}
        {result.autoLinks.length > 0 ? (
          <p>
            <span className="text-zinc-500">Auto-linked to: </span>
            <span className="text-zinc-300">
              {result.autoLinks.map((l) => l.externalId).join(", ")}
            </span>
          </p>
        ) : null}
        {result.unmatchedReferences.length > 0 ? (
          <p>
            <span className="text-zinc-500">References without match in this project: </span>
            <span className="text-amber-300">
              {result.unmatchedReferences.join(", ")}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
