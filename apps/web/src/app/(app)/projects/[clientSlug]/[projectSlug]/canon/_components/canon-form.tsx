"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type CanonActionState, saveCanonAction } from "../actions";

const initialState: CanonActionState = { status: "idle" };

interface SectionProps {
  name: "conventions" | "guidelines" | "architecture";
  label: string;
  description: string;
  defaultValue: string | null;
}

function CanonSection({ name, label, description, defaultValue }: SectionProps) {
  const initial = defaultValue ?? "";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40">
      <header className="border-b border-zinc-800 px-4 py-2.5">
        <h2 className="text-sm font-medium text-zinc-200">{label}</h2>
        <p className="mt-0.5 text-[11px] text-zinc-500">{description}</p>
      </header>
      <textarea
        name={name}
        defaultValue={initial}
        rows={14}
        placeholder={`Add ${label.toLowerCase()} for this project. Markdown is supported.`}
        className="w-full resize-y bg-transparent px-4 py-3 font-mono text-xs leading-relaxed text-zinc-200 outline-none focus:bg-zinc-900/40"
      />
      <footer className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
        {initial.length.toLocaleString()} chars
      </footer>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save canon"}
    </button>
  );
}

export function CanonForm({
  clientSlug,
  projectSlug,
  conventions,
  guidelines,
  architecture,
}: {
  clientSlug: string;
  projectSlug: string;
  conventions: string | null;
  guidelines: string | null;
  architecture: string | null;
}) {
  const [state, formAction] = useActionState(saveCanonAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="clientSlug" value={clientSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />

      <CanonSection
        name="conventions"
        label="Conventions"
        description="Naming, code style, formatting, PR conventions, anything that should hold across all changes."
        defaultValue={conventions}
      />
      <CanonSection
        name="guidelines"
        label="Guidelines"
        description="How the team works: testing posture, PR review SLAs, when to refactor, decision-making."
        defaultValue={guidelines}
      />
      <CanonSection
        name="architecture"
        label="Architecture"
        description="High-level shape of the system, modules, gotchas, sandboxes, integrations."
        defaultValue={architecture}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-zinc-500">
          Saving updates the database. The disk copy at{" "}
          <code className="font-mono text-zinc-400">
            corpus/&lt;client&gt;/&lt;project&gt;/_meta/*.md
          </code>{" "}
          is not touched — keep one as the source of truth or run{" "}
          <code className="font-mono text-zinc-400">pnpm db:meta:sync</code> to overwrite from disk.
        </p>
        <SubmitButton />
      </div>

      {state.status === "error" ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {state.message}
          {state.code ? <span className="ml-2 font-mono opacity-70">({state.code})</span> : null}
        </div>
      ) : null}

      {state.status === "success" ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          {state.message}
        </div>
      ) : null}
    </form>
  );
}
