"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type CanonDomainState, saveCanonDomainAction } from "../../actions";

const initialState: CanonDomainState = { status: "idle" };

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
        placeholder={`Add the domain's ${label.toLowerCase()}. Markdown is supported.`}
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

export function CanonDomainForm({
  slug,
  conventions,
  guidelines,
  architecture,
}: {
  slug: string;
  conventions: string | null;
  guidelines: string | null;
  architecture: string | null;
}) {
  const [state, formAction] = useActionState(saveCanonDomainAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      <CanonSection
        name="conventions"
        label="Conventions"
        description="Naming, formatting, code style for this domain. Defaults applied to ANY project in this domain unless project canon overrides."
        defaultValue={conventions}
      />
      <CanonSection
        name="guidelines"
        label="Guidelines"
        description="Way of working in this domain. Testing posture, PR review approach, when you choose pattern X over Y, etc."
        defaultValue={guidelines}
      />
      <CanonSection
        name="architecture"
        label="Architecture"
        description="Standard architectural patterns and constraints for this domain."
        defaultValue={architecture}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="max-w-2xl text-[11px] text-zinc-500">
          Project-level canon overrides this for projects in this domain that have their own
          conventions/guidelines/architecture. Use this for what is true regardless of which project
          in the domain you're working on.
        </p>
        <SubmitButton />
      </div>

      {state.status === "error" ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {state.message}
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
