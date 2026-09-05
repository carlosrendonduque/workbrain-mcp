"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { SignupTokenRow } from "@/lib/signup-tokens";
import {
  type CreateTokenState,
  type RevokeTokenState,
  createTokenAction,
  revokeTokenAction,
} from "../actions";

const TIMESTAMP = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" });

function formatTimestamp(value: Date | string | null): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : TIMESTAMP.format(d);
}

const createInitial: CreateTokenState = { status: "idle" };
const revokeInitial: RevokeTokenState = { status: "idle" };

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Creating…" : "Create token"}
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
        if (
          !confirm(`Revoke "${label}"? Anyone holding the token will no longer be able to use it.`)
        ) {
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
  const [state, formAction] = useActionState(createTokenAction, createInitial);

  const signupUrl =
    state.status === "success" ? `https://www.workbrain.app/signup?token=${state.rawToken}` : null;

  return (
    <div className="space-y-4">
      <form action={formAction} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto]">
        <div>
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
            placeholder="e.g. brother-laptop, beta-tester-1"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label
            htmlFor="expiresInDays"
            className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
          >
            Expires in (days)
          </label>
          <input
            id="expiresInDays"
            name="expiresInDays"
            type="number"
            min={0}
            placeholder="0 = never"
            className="mt-1 w-32 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
          />
        </div>
        <div className="self-end">
          <CreateButton />
        </div>
      </form>

      {state.status === "error" ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {state.message}
          {state.code ? <span className="ml-2 font-mono opacity-70">({state.code})</span> : null}
        </div>
      ) : null}

      {state.status === "success" && signupUrl ? (
        <div className="space-y-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-100">
          <p className="font-medium">
            Token "{state.label}" created. Copy now — you won't see the raw value again.
          </p>
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-emerald-200/80">
              Raw token (one-time use)
            </p>
            <div className="flex items-center justify-between gap-2">
              <code className="block flex-1 break-all rounded bg-zinc-950 px-3 py-2 font-mono text-[11px] text-emerald-200">
                {state.rawToken}
              </code>
              <CopyButton value={state.rawToken} />
            </div>
          </div>
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-emerald-200/80">
              Pre-filled signup link (share this)
            </p>
            <div className="flex items-center justify-between gap-2">
              <code className="block flex-1 break-all rounded bg-zinc-950 px-3 py-2 font-mono text-[11px] text-emerald-200">
                {signupUrl}
              </code>
              <CopyButton value={signupUrl} />
            </div>
            <p className="mt-1 text-[11px] text-emerald-200/70">
              Send the recipient this URL plus the email you want them to register with. They open
              it, type their email, click sign up, and get their first API key automatically.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RevokeForm({ tokenId, label }: { tokenId: string; label: string }) {
  const [state, formAction] = useActionState(revokeTokenAction, revokeInitial);
  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="tokenId" value={tokenId} />
        <input type="hidden" name="label" value={label} />
        <RevokeButton label={label} />
      </form>
      {state.status === "error" ? (
        <span className="text-[10px] text-red-300">{state.message}</span>
      ) : null}
    </div>
  );
}

function tokenStatus(row: SignupTokenRow): { label: string; cls: string } {
  if (row.usedByEmail) {
    return {
      label: "redeemed",
      cls: "border-zinc-700 bg-zinc-900 text-zinc-400",
    };
  }
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
    return {
      label: "expired",
      cls: "border-amber-500/30 bg-amber-500/15 text-amber-300",
    };
  }
  return {
    label: "active",
    cls: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  };
}

export function InviteTokensPage({ tokens }: { tokens: SignupTokenRow[] }) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="text-sm font-medium text-zinc-200">Generate an invite token</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Anyone you want to onboard needs a one-time token. Each token redeems for a fresh user
          account fully isolated from yours. Optional expiry helps if you don't want tokens
          lingering.
        </p>
        <div className="mt-4">
          <CreateForm />
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-medium text-zinc-200">Tokens you've issued</h2>
          <span className="text-xs text-zinc-500">{tokens.length} total</span>
        </header>
        {tokens.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-500">No tokens yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[34rem]">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-5 py-2 text-left font-medium">Label</th>
                  <th className="px-5 py-2 text-left font-medium">Status</th>
                  <th className="px-5 py-2 text-left font-medium">Created</th>
                  <th className="px-5 py-2 text-left font-medium">Expires</th>
                  <th className="px-5 py-2 text-left font-medium">Redeemed by</th>
                  <th className="px-5 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {tokens.map((t) => {
                  const status = tokenStatus(t);
                  return (
                    <tr key={t.tokenId} className="hover:bg-zinc-900/30">
                      <td className="px-5 py-3 font-medium text-zinc-100">{t.label}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${status.cls}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-zinc-400">
                        {formatTimestamp(t.createdAt)}
                      </td>
                      <td className="px-5 py-3 text-xs text-zinc-400">
                        {t.expiresAt ? formatTimestamp(t.expiresAt) : "never"}
                      </td>
                      <td className="px-5 py-3 text-xs text-zinc-400">
                        {t.usedByEmail ? (
                          <span className="font-mono text-zinc-300">{t.usedByEmail}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {t.usedByEmail ? (
                          <span className="text-[11px] text-zinc-600">—</span>
                        ) : (
                          <RevokeForm tokenId={t.tokenId} label={t.label} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
