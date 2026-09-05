"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { CanonDomainSummary } from "@/lib/canon-domains";
import type { ClientRow } from "@/lib/projects";
import { type CreateProjectState, createProjectAction } from "../actions";

const initialState: CreateProjectState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Creating…" : "Create project"}
    </button>
  );
}

export function CreateProjectForm({
  clients,
  domains,
}: {
  clients: ClientRow[];
  domains: CanonDomainSummary[];
}) {
  const [state, formAction] = useActionState(createProjectAction, initialState);
  const [mode, setMode] = useState<"existing" | "new-client">(
    clients.length > 0 ? "existing" : "new-client",
  );

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="mode" value={mode} />

      <fieldset className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
        <legend className="px-2 text-sm font-medium text-zinc-200">Client</legend>
        <p className="mb-3 text-xs text-zinc-500">
          Each project lives under a client. Pick one of yours or create a new client now.
        </p>
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            disabled={clients.length === 0}
            onClick={() => setMode("existing")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
              mode === "existing"
                ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/40"
                : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Existing client
          </button>
          <button
            type="button"
            onClick={() => setMode("new-client")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              mode === "new-client"
                ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/40"
                : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            New client
          </button>
        </div>

        {mode === "existing" ? (
          <div>
            <label
              htmlFor="existingClientId"
              className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              Pick a client
            </label>
            <select
              id="existingClientId"
              name="existingClientId"
              required
              defaultValue=""
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
            >
              <option value="" disabled>
                Pick a client…
              </option>
              {clients.map((c) => (
                <option key={c.clientId} value={c.clientId}>
                  {c.clientSlug} — {c.clientName}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label
                htmlFor="newClientSlug"
                className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
              >
                Client slug
              </label>
              <input
                id="newClientSlug"
                name="newClientSlug"
                required
                placeholder="ths"
                pattern="[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?"
                title="Lowercase letters, numbers and dashes only."
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                Lowercase, no spaces. Used in URLs (/projects/&lt;slug&gt;/...).
              </p>
            </div>
            <div>
              <label
                htmlFor="newClientName"
                className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
              >
                Client name
              </label>
              <input
                id="newClientName"
                name="newClientName"
                required
                placeholder="THS"
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
        <legend className="px-2 text-sm font-medium text-zinc-200">Project</legend>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="projectSlug"
              className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              Project slug
            </label>
            <input
              id="projectSlug"
              name="projectSlug"
              required
              placeholder="salesforce-platform"
              pattern="[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?"
              title="Lowercase letters, numbers and dashes only."
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Unique within the client. Used in URLs and as the projectSlug parameter for MCP tools.
            </p>
          </div>
          <div>
            <label
              htmlFor="projectName"
              className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              Project name
            </label>
            <input
              id="projectName"
              name="projectName"
              required
              placeholder="Salesforce Platform"
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            name="persist"
            defaultChecked
            className="rounded border-zinc-700 bg-zinc-900"
          />
          Persist documents (uncheck for ephemeral / scratch projects)
        </label>
      </fieldset>

      <fieldset className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
        <legend className="px-2 text-sm font-medium text-zinc-200">Canon domain</legend>
        <p className="mb-3 text-xs text-zinc-500">
          Pick the cross-project canon this project inherits. New projects must belong to a domain.
          If you don't have one yet,{" "}
          <Link href="/account/canons" className="text-indigo-300 hover:text-indigo-200">
            create one first
          </Link>
          .
        </p>
        {domains.length === 0 ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            You don't have any canon domains yet. Create one at{" "}
            <Link href="/account/canons" className="underline-offset-2 hover:underline">
              /account/canons
            </Link>{" "}
            before creating a project.
          </div>
        ) : (
          <div>
            <label
              htmlFor="domainId"
              className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              Domain
            </label>
            <select
              id="domainId"
              name="domainId"
              required
              defaultValue=""
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500"
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
          </div>
        )}
      </fieldset>

      <fieldset className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
        <legend className="px-2 text-sm font-medium text-zinc-200">Source repo (optional)</legend>
        <p className="mb-3 text-xs text-zinc-500">
          If this project lives in a git repo, link it here. The agent uses it to validate you're in
          the right folder, suggest clone, and offer feature-branch creation. Leave empty for
          projects without a public repo or with custom version-control systems.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_180px]">
          <div>
            <label
              htmlFor="repoUrl"
              className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              Repo URL
            </label>
            <input
              id="repoUrl"
              name="repoUrl"
              placeholder="https://github.com/foo/bar.git or git@dev.azure.com:..."
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label
              htmlFor="defaultBranch"
              className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
            >
              Default branch
            </label>
            <input
              id="defaultBranch"
              name="defaultBranch"
              placeholder="main"
              className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      </fieldset>

      <div className="flex items-center justify-end gap-3">
        <SubmitButton />
      </div>

      {state.status === "error" ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {state.message}
          {state.code ? <span className="ml-2 font-mono opacity-70">({state.code})</span> : null}
        </div>
      ) : null}
    </form>
  );
}
