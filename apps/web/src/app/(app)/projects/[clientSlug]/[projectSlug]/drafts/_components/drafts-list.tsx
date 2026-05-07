"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { DraftRow } from "@/lib/drafts";
import {
  type DraftActionState,
  approveAction,
  rejectAction,
} from "../actions";

const TIMESTAMP = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(value: Date | string | null): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : TIMESTAMP.format(d);
}

const initialState: DraftActionState = { status: "idle" };

function ApproveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Approving…" : label}
    </button>
  );
}

function RejectButton({ title }: { title: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!confirm(`Reject draft "${title}"? It won't enter the corpus.`)) {
          e.preventDefault();
        }
      }}
      className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] font-medium text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Rejecting…" : "Reject"}
    </button>
  );
}

function StatusPill({ status }: { status: DraftRow["status"] }) {
  const map: Record<DraftRow["status"], string> = {
    pending: "border-amber-500/30 bg-amber-500/15 text-amber-300",
    approved: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
    rejected: "border-zinc-700 bg-zinc-900 text-zinc-500",
  };
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${map[status]}`}
    >
      {status}
    </span>
  );
}

function DraftCard({
  draft,
  clientSlug,
  projectSlug,
  projectBasePath,
}: {
  draft: DraftRow;
  clientSlug: string;
  projectSlug: string;
  projectBasePath: string;
}) {
  const [approveState, approveFormAction] = useActionState(approveAction, initialState);
  const [rejectState, rejectFormAction] = useActionState(rejectAction, initialState);
  const [editing, setEditing] = useState(false);
  const isPending = draft.status === "pending";

  return (
    <li className="rounded-xl border border-zinc-800 bg-zinc-950/40">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-5 py-3">
        <StatusPill status={draft.status} />
        <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-300">
          {draft.proposedType}
        </span>
        {draft.proposedExternalId ? (
          <span className="font-mono text-xs text-indigo-300">
            {draft.proposedExternalId}
          </span>
        ) : null}
        <span className="font-medium text-zinc-100">{draft.proposedTitle}</span>
        <span className="ml-auto text-[11px] text-zinc-500">
          proposed by {draft.proposedBy} · {formatTimestamp(draft.createdAt)}
        </span>
      </div>

      {draft.proposalNote ? (
        <div className="border-b border-zinc-800/70 px-5 py-2 text-xs italic text-zinc-400">
          "{draft.proposalNote}"
        </div>
      ) : null}

      <details className="px-5 py-3 text-xs">
        <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
          show content ({draft.proposedContent.length.toLocaleString()} chars)
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-900 p-3 font-mono text-[11px] text-zinc-300">
          {draft.proposedContent}
        </pre>
      </details>

      {isPending ? (
        <div className="space-y-3 border-t border-zinc-800/70 px-5 py-3">
          {editing ? (
            <form action={approveFormAction} className="space-y-2">
              <input type="hidden" name="draftId" value={draft.draftId} />
              <input type="hidden" name="clientSlug" value={clientSlug} />
              <input type="hidden" name="projectSlug" value={projectSlug} />
              <div>
                <label className="text-[10px] uppercase tracking-wide text-zinc-500">
                  Edit title
                </label>
                <input
                  name="editTitle"
                  defaultValue={draft.proposedTitle}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-zinc-500">
                  Edit external_id (leave empty for none)
                </label>
                <input
                  name="editExternalId"
                  defaultValue={draft.proposedExternalId ?? ""}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-zinc-500">
                  Edit content
                </label>
                <textarea
                  name="editContent"
                  defaultValue={draft.proposedContent}
                  rows={10}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-indigo-500"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded border border-zinc-700 px-3 py-1 text-[11px] text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
                >
                  Cancel
                </button>
                <ApproveButton label="Approve with edits" />
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded border border-zinc-700 px-3 py-1 text-[11px] text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
              >
                Edit before approving
              </button>
              <form action={rejectFormAction}>
                <input type="hidden" name="draftId" value={draft.draftId} />
                <input type="hidden" name="clientSlug" value={clientSlug} />
                <input type="hidden" name="projectSlug" value={projectSlug} />
                <RejectButton title={draft.proposedTitle} />
              </form>
              <form action={approveFormAction}>
                <input type="hidden" name="draftId" value={draft.draftId} />
                <input type="hidden" name="clientSlug" value={clientSlug} />
                <input type="hidden" name="projectSlug" value={projectSlug} />
                <ApproveButton label="Approve" />
              </form>
            </div>
          )}
          {approveState.status === "error" ? (
            <p className="text-[11px] text-red-300">{approveState.message}</p>
          ) : null}
          {approveState.status === "success" ? (
            <p className="text-[11px] text-emerald-300">{approveState.message}</p>
          ) : null}
          {rejectState.status === "error" ? (
            <p className="text-[11px] text-red-300">{rejectState.message}</p>
          ) : null}
        </div>
      ) : draft.approvedDocumentId ? (
        <div className="border-t border-zinc-800/70 px-5 py-3 text-xs text-zinc-400">
          Approved →{" "}
          <Link
            href={`${projectBasePath}/${draft.proposedExternalId ?? draft.approvedDocumentId}`}
            className="text-indigo-300 hover:text-indigo-200"
          >
            view document
          </Link>
        </div>
      ) : null}
    </li>
  );
}

export function DraftsList({
  drafts,
  clientSlug,
  projectSlug,
  projectBasePath,
}: {
  drafts: DraftRow[];
  clientSlug: string;
  projectSlug: string;
  projectBasePath: string;
}) {
  if (drafts.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-500">
        No drafts. The agent will queue items here as you chat.
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {drafts.map((d) => (
        <DraftCard
          key={d.draftId}
          draft={d}
          clientSlug={clientSlug}
          projectSlug={projectSlug}
          projectBasePath={projectBasePath}
        />
      ))}
    </ul>
  );
}
