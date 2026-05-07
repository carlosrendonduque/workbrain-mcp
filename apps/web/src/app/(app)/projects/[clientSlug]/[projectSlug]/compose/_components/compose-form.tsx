"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { type ComposeActionState, composeAction } from "../actions";
import { ComposeResult } from "./compose-result";

export interface DocOption {
  externalId: string;
  type: string;
  title: string;
}

const initialState: ComposeActionState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Composing…" : "Compose context"}
    </button>
  );
}

export function ComposeForm({
  clientSlug,
  projectSlug,
  docs,
}: {
  clientSlug: string;
  projectSlug: string;
  docs: DocOption[];
}) {
  const [state, formAction] = useActionState(composeAction, initialState);
  const [mode, setMode] = useState<"focusExternalId" | "focusText">(
    docs.length > 0 ? "focusExternalId" : "focusText",
  );

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="clientSlug" value={clientSlug} />
        <input type="hidden" name="projectSlug" value={projectSlug} />
        <input type="hidden" name="mode" value={mode} />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("focusExternalId")}
            disabled={docs.length === 0}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
              mode === "focusExternalId"
                ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/40"
                : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            From document
          </button>
          <button
            type="button"
            onClick={() => setMode("focusText")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              mode === "focusText"
                ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/40"
                : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            From free text
          </button>
        </div>

        {mode === "focusExternalId" ? (
          <div>
            <label
              htmlFor="focusExternalId"
              className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              Focus document
            </label>
            <select
              id="focusExternalId"
              name="focusExternalId"
              defaultValue=""
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            >
              <option value="" disabled>
                Pick a document with an external_id…
              </option>
              {docs.map((d) => (
                <option key={d.externalId} value={d.externalId}>
                  [{d.type}] {d.externalId} — {d.title}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-zinc-500">
              Only documents with an external_id can be used as focus. To use a doc
              without one, switch to "From free text" and paste a snippet.
            </p>
          </div>
        ) : (
          <div>
            <label
              htmlFor="focusText"
              className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              Focus text
            </label>
            <textarea
              id="focusText"
              name="focusText"
              rows={6}
              placeholder="Describe what you're working on, paste a code snippet, or type a question. Used as the RAG query when there is no focus document."
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
            />
          </div>
        )}

        <div className="flex items-center justify-end">
          <SubmitButton />
        </div>
      </form>

      {state.status === "error" ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <p className="font-medium">Compose failed</p>
          <p className="mt-1 text-xs text-red-300">{state.message}</p>
          {state.code ? (
            <p className="mt-1 font-mono text-[11px] text-red-400/70">code: {state.code}</p>
          ) : null}
        </div>
      ) : null}

      {state.status === "success" ? (
        <ComposeResult
          result={state.result}
          clientSlug={state.clientSlug}
          projectSlug={state.projectSlug}
        />
      ) : null}
    </div>
  );
}
