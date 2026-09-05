"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { type SignupActionState, signupAction } from "../actions";

const initialState: SignupActionState = { status: "idle" };
const MCP_URL = "https://www.workbrain.app/api/mcp";

function base64UrlEncode(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function cursorInstallUrl(rawKey: string): string {
  const config = {
    url: MCP_URL,
    headers: { Authorization: `Bearer ${rawKey}` },
  };
  return `https://cursor.com/install-mcp?name=workbrain&config=${base64UrlEncode(JSON.stringify(config))}`;
}

function claudeCliCommand(rawKey: string): string {
  return `claude mcp add workbrain --scope user --transport http \\
  ${MCP_URL} \\
  --header "Authorization: Bearer ${rawKey}"`;
}

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

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Creating account…" : "Create account"}
    </button>
  );
}

export function SignupForm({ initialToken }: { initialToken?: string }) {
  const [state, formAction] = useActionState(signupAction, initialState);

  if (state.status === "success") {
    const cursorUrl = cursorInstallUrl(state.apiKey);
    const cliCommand = claudeCliCommand(state.apiKey);
    return (
      <div className="space-y-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-sm text-emerald-100">
        <div>
          <h2 className="text-lg font-semibold">Account ready ✓</h2>
          <p className="mt-1 text-xs text-emerald-200/80">
            Welcome <span className="font-mono">{state.email}</span>. Below is your API key — copy
            it now, it won't be shown again.
          </p>
        </div>

        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-emerald-200/80">
            Your API key
          </p>
          <div className="flex items-center gap-2">
            <code className="block flex-1 break-all rounded bg-zinc-950 px-3 py-2 font-mono text-[11px] text-emerald-200">
              {state.apiKey}
            </code>
            <CopyButton value={state.apiKey} />
          </div>
        </div>

        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-emerald-200/80">
            Connect your IDE
          </p>
          <div className="space-y-2">
            <a
              href={cursorUrl}
              className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500"
            >
              Add to Cursor →
            </a>
            <details className="rounded border border-zinc-800 bg-zinc-950">
              <summary className="cursor-pointer px-3 py-2 text-[11px] text-zinc-400">
                Or use Claude Code (CLI / VS Code extension)
              </summary>
              <div className="border-t border-zinc-800 p-2">
                <div className="mb-1 flex items-center justify-end">
                  <CopyButton value={cliCommand} />
                </div>
                <pre className="overflow-x-auto rounded bg-zinc-950 px-3 py-2 font-mono text-[11px] text-emerald-200">
                  {cliCommand}
                </pre>
              </div>
            </details>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Link href="/login" className="text-emerald-200 underline-offset-2 hover:underline">
            Sign in to the dashboard →
          </Link>
          <Link href="/setup" className="text-emerald-200 underline-offset-2 hover:underline">
            Full setup guide →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label
          htmlFor="email"
          className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          autoComplete="email"
          className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
        />
      </div>

      <div>
        <label
          htmlFor="token"
          className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
        >
          Invitation token
        </label>
        <input
          id="token"
          name="token"
          required
          defaultValue={initialToken ?? ""}
          placeholder="inv_…"
          className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
        />
        <p className="mt-1 text-[11px] text-zinc-500">
          Need one? Ask whoever invited you to send it via{" "}
          <code className="font-mono">/account/invite-tokens</code>.
        </p>
      </div>

      <SubmitButton />

      {state.status === "error" ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {state.message}
          {state.code ? <span className="ml-2 font-mono opacity-70">({state.code})</span> : null}
        </div>
      ) : null}
    </form>
  );
}
