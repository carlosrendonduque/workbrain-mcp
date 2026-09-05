"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ApiKeyRow } from "@/lib/api-keys";
import {
  type CreateKeyState,
  type RevokeKeyState,
  createKeyAction,
  revokeKeyAction,
} from "../actions";

const MCP_URL = "https://www.workbrain.app/api/mcp";

function base64UrlEncode(s: string): string {
  // btoa runs in the browser; for ASCII JSON it's safe.
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

function cursorJsonSnippet(rawKey: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        workbrain: {
          url: MCP_URL,
          headers: { Authorization: `Bearer ${rawKey}` },
        },
      },
    },
    null,
    2,
  );
}

function claudeDesktopJsonSnippet(rawKey: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        workbrain: {
          type: "http",
          url: MCP_URL,
          headers: { Authorization: `Bearer ${rawKey}` },
        },
      },
    },
    null,
    2,
  );
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

function ConnectInstructionsForKey({ rawKey }: { rawKey: string }) {
  const [tab, setTab] = useState<"cursor" | "cli" | "vscode" | "desktop">("cursor");
  const cursorUrl = cursorInstallUrl(rawKey);
  const cliCommand = claudeCliCommand(rawKey);
  const cursorJson = cursorJsonSnippet(rawKey);
  const desktopJson = claudeDesktopJsonSnippet(rawKey);

  const tabs: ReadonlyArray<{ id: typeof tab; label: string }> = [
    { id: "cursor", label: "Cursor" },
    { id: "cli", label: "Claude Code (CLI)" },
    { id: "vscode", label: "Claude Code (VS Code)" },
    { id: "desktop", label: "Claude Desktop" },
  ];

  return (
    <div>
      <p className="mb-2 text-[11px] uppercase tracking-wide text-emerald-200/80">
        Connect this key to your IDE
      </p>
      <div className="mb-2 flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded px-2 py-1 text-[10px] font-medium transition ${
              tab === t.id
                ? "bg-emerald-500/20 text-emerald-100 ring-1 ring-emerald-400/40"
                : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cursor" ? (
        <div className="space-y-2">
          <a
            href={cursorUrl}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500"
          >
            Add to Cursor →
          </a>
          <p className="text-[11px] text-emerald-200/70">
            One click — opens Cursor and auto-installs the MCP server. If Cursor isn't installed or
            the link doesn't open, fallback below: paste the JSON into{" "}
            <code className="font-mono">~/.cursor/mcp.json</code>.
          </p>
          <details className="rounded border border-zinc-800 bg-zinc-950">
            <summary className="cursor-pointer px-3 py-2 text-[11px] text-zinc-400">
              Manual fallback (~/.cursor/mcp.json)
            </summary>
            <div className="border-t border-zinc-800 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-[10px] text-zinc-500">~/.cursor/mcp.json</span>
                <CopyButton value={cursorJson} />
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-zinc-200">
                {cursorJson}
              </pre>
            </div>
          </details>
        </div>
      ) : null}

      {tab === "cli" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-emerald-200/70">
              Run in any terminal — registers globally for all folders.
            </span>
            <CopyButton value={cliCommand} />
          </div>
          <pre className="overflow-x-auto rounded bg-zinc-950 px-3 py-2 font-mono text-[11px] text-emerald-200">
            {cliCommand}
          </pre>
        </div>
      ) : null}

      {tab === "vscode" ? (
        <div className="space-y-2">
          <p className="text-[11px] text-emerald-200/70">
            Run the CLI command above (the Claude Code VS Code extension shares
            <code className="font-mono"> ~/.claude.json</code> with the CLI). After running, reload
            VS Code (Cmd/Ctrl+Shift+P → "Reload Window").
          </p>
          <pre className="overflow-x-auto rounded bg-zinc-950 px-3 py-2 font-mono text-[11px] text-emerald-200">
            {cliCommand}
          </pre>
        </div>
      ) : null}

      {tab === "desktop" ? (
        <div className="space-y-2">
          <p className="text-[11px] text-emerald-200/70">
            Edit <code className="font-mono">claude_desktop_config.json</code> (Settings → Developer
            → Edit Config) and merge the snippet below. Restart Claude Desktop.
          </p>
          <div className="flex items-center justify-end">
            <CopyButton value={desktopJson} />
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-zinc-950 px-3 py-2 font-mono text-[11px] text-emerald-200">
            {desktopJson}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

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

export interface ClientOption {
  clientId: string;
  clientSlug: string;
  clientName: string;
}

function CreateForm({ clients }: { clients: ClientOption[] }) {
  const [state, formAction] = useActionState(createKeyAction, createInitial);

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
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
        <div className="min-w-[200px]">
          <label
            htmlFor="clientId"
            className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
          >
            Can reach
          </label>
          <select
            id="clientId"
            name="clientId"
            defaultValue=""
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500"
          >
            <option value="">Every client</option>
            {clients.map((c) => (
              <option key={c.clientId} value={c.clientId}>
                {c.clientName} ({c.clientSlug})
              </option>
            ))}
          </select>
        </div>
        <CreateButton />
      </form>
      <p className="text-xs text-zinc-500">
        A key limited to one client can only read and write that client. Use it for the key that
        lives in that client's repo, so losing the laptop exposes one engagement instead of all of
        them.
      </p>

      {state.status === "error" ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {state.message}
          {state.code ? <span className="ml-2 font-mono opacity-70">({state.code})</span> : null}
        </div>
      ) : null}

      {state.status === "success" ? (
        <div className="space-y-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-100">
          <div>
            <p className="font-medium">
              Key for "{state.label}" created. Copy it now — it won't be shown again.
            </p>
            <p className="mt-1 opacity-80">
              {state.clientSlug
                ? `Limited to the client "${state.clientSlug}". It cannot reach any other.`
                : "Reaches every client you own."}
            </p>
            <code className="mt-2 block break-all rounded bg-zinc-950 px-3 py-2 font-mono text-[11px] text-emerald-200">
              {state.rawKey}
            </code>
          </div>
          <ConnectInstructionsForKey rawKey={state.rawKey} />
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

function ConnectInstructions() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
      <h2 className="text-sm font-medium text-zinc-200">Connect an IDE to WorkBrain</h2>
      <p className="mt-1 text-xs text-zinc-500">
        WorkBrain exposes an MCP HTTP endpoint at{" "}
        <code className="font-mono text-zinc-300">https://www.workbrain.app/api/mcp</code>. To
        connect any IDE that speaks MCP (Claude Code, Cursor, Claude Desktop, etc.), point it at
        that URL with one of your API keys. Below is the command for Claude Code; the pattern is
        similar for other clients.
      </p>
      <pre className="mt-3 overflow-x-auto rounded bg-zinc-950 px-3 py-2 font-mono text-[11px] text-zinc-200">
        {`claude mcp add workbrain --transport http \\
  https://www.workbrain.app/api/mcp \\
  --header "Authorization: Bearer wbk_REPLACE_WITH_YOUR_KEY"`}
      </pre>
      <p className="mt-2 text-[11px] text-zinc-500">
        Create a new key below to get the full command pre-filled. Keys are shown once at creation —
        the raw value is not retrievable later.
      </p>
    </section>
  );
}

export function ApiKeysPage({ keys, clients }: { keys: ApiKeyRow[]; clients: ClientOption[] }) {
  return (
    <div className="space-y-6">
      <ConnectInstructions />

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="text-sm font-medium text-zinc-200">Create a new key</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Give it a label that tells you where it lives (machine, app, role), and limit it to one
          client when it will only ever be used for that client.
        </p>
        <div className="mt-4">
          <CreateForm clients={clients} />
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[34rem]">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-5 py-2 text-left font-medium">Label</th>
                  <th className="px-5 py-2 text-left font-medium">Can reach</th>
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
                    <td className="px-5 py-3 text-xs">
                      {k.clientSlug ? (
                        <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[11px] text-amber-200">
                          {k.clientSlug}
                        </span>
                      ) : (
                        <span className="text-zinc-500">every client</span>
                      )}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-zinc-500">
                      {k.hashFingerprint}…
                    </td>
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
          </div>
        )}
      </section>
    </div>
  );
}
