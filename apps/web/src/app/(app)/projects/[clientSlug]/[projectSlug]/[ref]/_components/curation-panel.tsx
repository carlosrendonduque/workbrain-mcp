"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  type CurationActionState,
  addLinkAction,
  archiveAction,
  markSupersededAction,
} from "../actions";

const LINK_TYPE_OPTIONS = [
  { value: "depends_on", label: "depends on" },
  { value: "related", label: "related" },
  { value: "supersedes", label: "supersedes" },
  { value: "discusses", label: "discusses" },
  { value: "decided_in", label: "decided in" },
  { value: "references", label: "references" },
] as const;

const initialState: CurationActionState = { status: "idle" };

export interface CandidateDoc {
  externalId: string;
  type: string;
  title: string;
}

interface RouteProps {
  clientSlug: string;
  projectSlug: string;
  documentRef: string;
  thisDocPath: string;
  documentId: string;
  thisDocExternalId: string | null;
  isArchived: boolean;
  candidates: CandidateDoc[];
}

function StateBanner({ state }: { state: CurationActionState }) {
  if (state.status === "idle") return null;
  if (state.status === "success") {
    return (
      <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
        {state.message}
      </p>
    );
  }
  return (
    <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
      {state.message}
      {state.code ? <span className="ml-2 font-mono opacity-70">({state.code})</span> : null}
    </p>
  );
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function HiddenRoute(props: {
  clientSlug: string;
  projectSlug: string;
  documentRef: string;
  thisDocPath: string;
  documentId?: string;
}) {
  return (
    <>
      <input type="hidden" name="clientSlug" value={props.clientSlug} />
      <input type="hidden" name="projectSlug" value={props.projectSlug} />
      <input type="hidden" name="ref" value={props.documentRef} />
      <input type="hidden" name="thisDocPath" value={props.thisDocPath} />
      {props.documentId ? <input type="hidden" name="documentId" value={props.documentId} /> : null}
    </>
  );
}

function AddLinkForm(props: RouteProps) {
  const [state, formAction] = useActionState(addLinkAction, initialState);
  const candidates = props.candidates;

  return (
    <form action={formAction} className="space-y-2">
      <HiddenRoute {...props} />
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        Link to another document
      </h3>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <select
          name="toExternalId"
          required
          defaultValue=""
          disabled={candidates.length === 0}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500 disabled:opacity-50"
        >
          <option value="" disabled>
            {candidates.length === 0
              ? "No other documents with external_id"
              : "Pick target document…"}
          </option>
          {candidates.map((d) => (
            <option key={d.externalId} value={d.externalId}>
              [{d.type}] {d.externalId} — {d.title}
            </option>
          ))}
        </select>
        <select
          name="linkType"
          required
          defaultValue="related"
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500"
        >
          {LINK_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <input
        name="note"
        placeholder="Optional note"
        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
      />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-zinc-500">Direction: this doc → target. Idempotent.</p>
        <SubmitButton label="Add link" pendingLabel="Linking…" />
      </div>
      <StateBanner state={state} />
    </form>
  );
}

function MarkSupersededForm(props: RouteProps) {
  const [state, formAction] = useActionState(markSupersededAction, initialState);

  return (
    <form action={formAction} className="space-y-2">
      <HiddenRoute {...props} />
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        Mark as superseded by
      </h3>
      <select
        name="fromExternalId"
        required
        defaultValue=""
        disabled={props.candidates.length === 0}
        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500 disabled:opacity-50"
      >
        <option value="" disabled>
          {props.candidates.length === 0
            ? "No other documents with external_id"
            : "Pick the newer document…"}
        </option>
        {props.candidates.map((d) => (
          <option key={d.externalId} value={d.externalId}>
            [{d.type}] {d.externalId} — {d.title}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-[11px] text-zinc-400">
        <input
          type="checkbox"
          name="alsoArchive"
          defaultChecked
          className="rounded border-zinc-700 bg-zinc-900"
        />
        Also archive this document (excludes from RAG)
      </label>
      <div className="flex justify-end">
        <SubmitButton label="Mark superseded" pendingLabel="Updating…" />
      </div>
      <StateBanner state={state} />
    </form>
  );
}

function ArchiveForm(props: RouteProps) {
  const [state, formAction] = useActionState(archiveAction, initialState);

  return (
    <form action={formAction} className="space-y-2">
      <HiddenRoute {...props} />
      <input type="hidden" name="op" value={props.isArchived ? "unarchive" : "archive"} />
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {props.isArchived ? "Unarchive" : "Archive"}
      </h3>
      <p className="text-[11px] text-zinc-500">
        {props.isArchived
          ? "Restores this document — included again in search and compose."
          : "Excludes this document from search and compose without deleting it."}
      </p>
      <div className="flex justify-end">
        <SubmitButton
          label={props.isArchived ? "Unarchive" : "Archive"}
          pendingLabel={props.isArchived ? "Unarchiving…" : "Archiving…"}
        />
      </div>
      <StateBanner state={state} />
    </form>
  );
}

export function CurationPanel(props: RouteProps) {
  return (
    <div className="space-y-5 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <header>
        <h2 className="text-sm font-medium text-zinc-200">Curation</h2>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          Maintain the corpus without leaving the browser.
        </p>
      </header>

      <AddLinkForm {...props} />
      <div className="border-t border-zinc-800/70" />
      <MarkSupersededForm {...props} />
      <div className="border-t border-zinc-800/70" />
      <ArchiveForm {...props} />
    </div>
  );
}
