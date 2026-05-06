"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

export interface ProjectOption {
  projectId: string;
  label: string;
}

interface Props {
  projects: ProjectOption[];
  operations: string[];
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any status" },
  { value: "success", label: "Success" },
  { value: "error", label: "Error" },
];

export function AuditFilters({ projects, operations }: Props) {
  const router = useRouter();
  const sp = useSearchParams();

  const project = sp?.get("project") ?? "";
  const operation = sp?.get("operation") ?? "";
  const status = sp?.get("status") ?? "";

  function update(key: "project" | "operation" | "status", value: string): void {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `/audit?${qs}` : "/audit");
  }

  const hasFilters = Boolean(project || operation || status);

  const baseSelect =
    "rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={baseSelect}
        value={project}
        onChange={(e) => update("project", e.target.value)}
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.projectId} value={p.projectId}>
            {p.label}
          </option>
        ))}
      </select>

      <select
        className={baseSelect}
        value={operation}
        onChange={(e) => update("operation", e.target.value)}
      >
        <option value="">All operations</option>
        {operations.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>

      <select
        className={baseSelect}
        value={status}
        onChange={(e) => update("status", e.target.value)}
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      {hasFilters ? (
        <Link href="/audit" className="text-xs text-zinc-500 hover:text-zinc-200">
          Clear
        </Link>
      ) : null}
    </div>
  );
}
