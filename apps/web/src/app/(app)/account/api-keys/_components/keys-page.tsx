"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ApiKeyRow } from "@/lib/api-keys";
import {
  type CreateKeyState,
  type RevokeKeyState,
  createKeyAction,
  revokeKeyAction,
} from "../actions";

const TIMESTAMP = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" });

function formatTimestamp(value: Date | string | null): string {
  if (!value) return "never";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : TIMESTAMP.format(d);
}

const createInitial: CreateKeyState = { status: "idle" };
const revokeInitial: RevokeKeyState = { status: "idle" };

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Creating…" : "Create key"}
    </button>
  );
}

function RevokeButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!confirm(`Revoke "${label}"? This is immediate and cannot be undone.`)) {
          e.preventDefault();
        }
      }}
      className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] font-medium text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Revoking…" : "Revoke"}
    </button>
  );
}

function CreateForm() {
  const [state, formAction] = useActionState(createKeyAction, createInitial);

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex items-end gap-2">
        <div className="flex-1">
          <label
            htmlFor="label"
            className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
          >
            Label
          </label>
          <input
            id="label"
            name="label"
            required
            placeholder="e.g. cursor-laptop, claude-code-cli, ci-pipeline"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
          />
        </div>
        <CreateButton />
      </form>

      {state.status === "error" ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {state.message}
          {state.code ? <span className="ml-2 font-mono opacity-70">({state.code})</span> : null}
        </div>
      ) : null}

      {state.status === "success" ? (
        <div className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-100">
          <p className="font-medium">
            Key for "{state.label}" created. Copy it now — it won't be shown again.
          </p>
          <code className="block break-all rounded bg-zinc-950 px-3 py-2 font-mono text-[11px] text-emerald-200">
            {state.rawKey}
          </code>
          <p className="text-[11px] text-emerald-200/70">
            Use as <code className="font-mono">Authorization: Bearer {state.rawKey.slice(0, 12)}…</code>{" "}
            in your IDE's MCP config or API calls.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function RevokeForm({ apiKeyId, label }: { apiKeyId: string; label: string }) {
  const [state, formAction] = useActionState(revokeKeyAction, revokeInitial);
  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="apiKeyId" value={apiKeyId} />
        <input type="hidden" name="label" value={label} />
        <RevokeButton label={label} />
      </form>
      {state.status === "error" ? (
        <span className="text-[10px] text-red-300">{state.message}</span>
      ) : null}
    </div>
  );
}

export function ApiKeysPage({ keys }: { keys: ApiKeyRow[] }) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="text-sm font-medium text-zinc-200">Create a new key</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Give it a label that tells you where it lives (machine, app, role).
        </p>
        <div className="mt-4">
          <CreateForm />
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-medium text-zinc-200">Active keys</h2>
          <span className="text-xs text-zinc-500">{keys.length} total</span>
        </header>
        {keys.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-500">No keys yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-5 py-2 text-left font-medium">Label</th>
                <th className="px-5 py-2 text-left font-medium">Hash fingerprint</th>
                <th className="px-5 py-2 text-left font-medium">Created</th>
                <th className="px-5 py-2 text-left font-medium">Last used</th>
                <th className="px-5 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {keys.map((k) => (
                <tr key={k.apiKeyId} className="hover:bg-zinc-900/30">
                  <td className="px-5 py-3 font-medium text-zinc-100">{k.label}</td>
                  <td className="px-5 py-3 font-mono text-xs text-zinc-500">{k.hashFingerprint}…</td>
                  <td className="px-5 py-3 text-xs text-zinc-400">
                    {formatTimestamp(k.createdAt)}
                  </td>
                  <td className="px-5 py-3 text-xs text-zinc-400">
                    {formatTimestamp(k.lastUsedAt)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <RevokeForm apiKeyId={k.apiKeyId} label={k.label} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
