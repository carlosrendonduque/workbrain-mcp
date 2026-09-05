import Link from "next/link";
import { notFound } from "next/navigation";
import { getCanonDomainBySlug } from "@/lib/canon-domains";
import { requireSession } from "@/lib/webapp-auth";
import { CanonDomainForm } from "./_components/canon-domain-form";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function CanonDomainEditPage({ params }: PageProps) {
  const session = await requireSession();
  const { slug } = await params;
  const domain = await getCanonDomainBySlug(session.userId, slug);
  if (!domain) notFound();

  return (
    <div className="px-8 py-8">
      <nav className="mb-2 text-xs text-zinc-500">
        <Link href="/account/canons" className="hover:text-zinc-300">
          Canons
        </Link>
        <span className="mx-2">/</span>
        <span className="font-mono text-zinc-300">{domain.slug}</span>
      </nav>

      <header className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-100">{domain.name}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Cross-project canon for the <code className="font-mono">{domain.slug}</code> domain.
          Applied as the default for every project assigned to this domain. Project-level canon (set
          at <code className="font-mono">/projects/&lt;client&gt;/&lt;project&gt;/canon</code>)
          overrides where it exists.
        </p>
      </header>

      <div className="max-w-3xl">
        <CanonDomainForm
          slug={domain.slug}
          conventions={domain.conventions}
          guidelines={domain.guidelines}
          architecture={domain.architecture}
        />
      </div>
    </div>
  );
}
