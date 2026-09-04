import { listApiKeys } from "@/lib/api-keys";
import { listClientsForUser } from "@/lib/projects";
import { requireSession } from "@/lib/webapp-auth";
import { ApiKeysPage } from "./_components/keys-page";

export const dynamic = "force-dynamic";

export default async function AccountApiKeysPage() {
  const session = await requireSession();
  const [keys, clients] = await Promise.all([
    listApiKeys(session.userId),
    listClientsForUser(session.userId),
  ]);

  return (
    <div className="px-8 py-8">
      <header className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-100">API keys</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Each key authenticates one IDE / agent / script. Stored as HMAC hash — once created, the
          raw key is shown once and never again. A key can be limited to a single client, so the one
          sitting in that client's repo cannot reach any other.
        </p>
      </header>

      <div className="max-w-4xl">
        <ApiKeysPage
          keys={keys}
          clients={clients.map((c) => ({
            clientId: c.clientId,
            clientSlug: c.clientSlug,
            clientName: c.clientName,
          }))}
        />
      </div>
    </div>
  );
}
