import { getUserCanon } from "@/lib/user-canon";
import { requireSession } from "@/lib/webapp-auth";
import { UserCanonForm } from "./_components/user-canon-form";

export const dynamic = "force-dynamic";

export default async function AccountCanonPage() {
  const session = await requireSession();
  const canon = await getUserCanon(session.userId);

  return (
    <div className="px-8 py-8">
      <header className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-100">Personal canon</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Your cross-project conventions, guidelines and architecture. Applied as the
          default for every project you own. Project-level canon (set at{" "}
          <code className="font-mono">/projects/&lt;client&gt;/&lt;project&gt;/canon</code>)
          overrides where it exists. Useful when your conventions are stable across
          clients (e.g. naming, testing posture) but each project has client-specific
          architecture.
        </p>
      </header>

      <div className="max-w-3xl">
        <UserCanonForm
          conventions={canon.conventions}
          guidelines={canon.guidelines}
          architecture={canon.architecture}
        />
      </div>
    </div>
  );
}
