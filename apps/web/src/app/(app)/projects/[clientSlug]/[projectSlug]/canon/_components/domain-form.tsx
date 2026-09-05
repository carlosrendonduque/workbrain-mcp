"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { CanonDomainSummary } from "@/lib/canon-domains";
import { type DomainAssignState, assignProjectDomainAction } from "../actions";

const initialState: DomainAssignState = { status: "idle" };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

export function ProjectDomainForm({
  clientSlug,
  projectSlug,
  currentDomainId,
  currentDomainSlug,
  currentDomainName,
  domains,
}: {
  clientSlug: string;
  projectSlug: string;
  currentDomainId: string | null;
  currentDomainSlug: string | null;
  currentDomainName: string | null;
  domains: CanonDomainSummary[];
}) {
  const [state, formAction] = useActionState(assignProjectDomainAction, initialState);
  const hasDomain = currentDomainId !== null;

  return (
    <div
      className={`rounded-xl border p-4 ${
        hasDomain ? "border-zinc-800 bg-zinc-950/40" : "border-amber-500/30 bg-amber-500/5"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-zinc-200">Canon domain</h2>
        {hasDomain ? (
          <span className="text-[11px] text-zinc-500">
            inherits from{" "}
            <Link
              href={`/account/canons/${currentDomainSlug}`}
              className="font-mono text-indigo-300 hover:text-indigo-200"
            >
              {currentDomainSlug}
            </Link>
          </span>
        ) : (
          <span className="text-[11px] text-amber-300">no domain assigned</span>
        )}
      </div>

      {!hasDomain ? (
        <p className="mb-3 text-xs text-amber-200/80">
          This project has no canon domain. The agent only sees project-level canon and won't
          inherit cross-project conventions. Pick a domain below or{" "}
          <Link href="/account/canons" className="underline-offset-2 hover:underline">
            create a new one
          </Link>
          .
        </p>
      ) : (
        <p className="mb-3 text-[11px] text-zinc-500">
          Currently inheriting from <strong>{currentDomainName}</strong>. Change to a different
          domain if this project belongs to another practice area.
        </p>
      )}

      {domains.length === 0 ? (
        <p className="text-xs text-zinc-400">
          You don't have any canon domains yet.{" "}
          <Link href="/account/canons" className="text-indigo-300 hover:text-indigo-200">
            Create one
          </Link>{" "}
          first.
        </p>
      ) : (
        <form action={formAction} className="flex items-center gap-2">
          <input type="hidden" name="clientSlug" value={clientSlug} />
          <input type="hidden" name="projectSlug" value={projectSlug} />
          <select
            name="domainId"
            required
            defaultValue={currentDomainId ?? ""}
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500"
          >
            <option value="" disabled>
              Pick a domain…
            </option>
            {domains.map((d) => (
              <option key={d.domainId} value={d.domainId}>
                {d.slug} — {d.name}
              </option>
            ))}
          </select>
          <SubmitButton label={hasDomain ? "Change domain" : "Assign domain"} />
        </form>
      )}

      {state.status === "error" ? (
        <p className="mt-2 text-[11px] text-red-300">{state.message}</p>
      ) : null}
      {state.status === "success" ? (
        <p className="mt-2 text-[11px] text-emerald-300">{state.message}</p>
      ) : null}
    </div>
  );
}
