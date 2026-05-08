"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { type CanonDomainState, createCanonDomainAction } from "../actions";

const initialState: CanonDomainState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Creating…" : "Create domain"}
    </button>
  );
}

export function CreateCanonDomainForm() {
  const [state, formAction] = useActionState(createCanonDomainAction, initialState);

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wide text-zinc-500">
            Slug
          </label>
          <input
            name="slug"
            placeholder="salesforce"
            required
            pattern="[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide text-zinc-500">
            Name
          </label>
          <input
            name="name"
            placeholder="Salesforce consulting"
            required
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500"
          />
        </div>
      </div>
      <div className="flex items-center justify-end">
        <SubmitButton />
      </div>
      {state.status === "error" ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {state.message}
        </div>
      ) : null}
    </form>
  );
}
