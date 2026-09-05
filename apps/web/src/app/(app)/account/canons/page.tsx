import Link from "next/link";
import { listCanonDomainsForUser } from "@/lib/canon-domains";
import { requireSession } from "@/lib/webapp-auth";
import { CreateCanonDomainForm } from "./_components/create-canon-domain-form";

export const dynamic = "force-dynamic";

const TIMESTAMP = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : TIMESTAMP.format(d);
}

function CanonPill({ label, present }: { label: string; present: boolean }) {
  const cls = present
    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
    : "border-zinc-700 bg-zinc-900 text-zinc-500";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

export default async function CanonsListPage() {
  const session = await requireSession();
  const domains = await listCanonDomainsForUser(session.userId);

  return (
    <div className="px-8 py-8">
      <header className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-100">Canons</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Cross-project conventions, guidelines and architecture grouped by domain. A consultant
          working on more than one practice area (e.g. Salesforce and digital narratives) keeps each
          body of canon completely separate. Each project belongs to one domain and inherits its
          canon as the default; project-level canon overrides where set.
        </p>
      </header>

      <section className="mb-8 max-w-3xl">
        <h2 className="mb-2 text-sm font-medium text-zinc-300">Your domains</h2>
        {domains.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-500">
            You haven't created any canon domains yet. Create one below — start with something like{" "}
            <code className="font-mono text-zinc-300">salesforce</code> or{" "}
            <code className="font-mono text-zinc-300">digital-narratives</code>.
          </div>
        ) : (
          <ul className="space-y-2">
            {domains.map((d) => (
              <li
                key={d.domainId}
                className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-5 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/account/canons/${d.slug}`}
                    className="font-medium text-zinc-100 hover:text-indigo-200"
                  >
                    {d.name}
                  </Link>
                  <span className="font-mono text-xs text-zinc-500">{d.slug}</span>
                  <span className="ml-auto text-[11px] text-zinc-500">
                    {d.projectCount} project{d.projectCount === 1 ? "" : "s"} · updated{" "}
                    {formatTimestamp(d.updatedAt)}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <CanonPill label="conventions" present={d.hasConventions} />
                  <CanonPill label="guidelines" present={d.hasGuidelines} />
                  <CanonPill label="architecture" present={d.hasArchitecture} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="max-w-3xl">
        <h2 className="mb-2 text-sm font-medium text-zinc-300">Create a new domain</h2>
        <p className="mb-3 text-xs text-zinc-500">
          A domain groups projects that share cross-project canon. After creating it you can edit
          conventions, guidelines and architecture, and assign projects to it from each project's
          editor.
        </p>
        <CreateCanonDomainForm />
      </section>
    </div>
  );
}
