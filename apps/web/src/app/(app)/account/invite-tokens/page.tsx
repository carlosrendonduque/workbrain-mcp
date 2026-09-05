import { listSignupTokens } from "@/lib/signup-tokens";
import { requireSession } from "@/lib/webapp-auth";
import { InviteTokensPage } from "./_components/tokens-page";

export const dynamic = "force-dynamic";

export default async function AccountInviteTokensPage() {
  const session = await requireSession();
  const tokens = await listSignupTokens(session.userId);

  return (
    <div className="px-8 py-8">
      <header className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-zinc-100">Invite tokens</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Signup is invite-only while WorkBrain is in MVP. Issue a token to anyone you want
          onboarded — they redeem it at <code className="font-mono">/signup</code> to create their
          own isolated account.
        </p>
      </header>

      <div className="max-w-4xl">
        <InviteTokensPage tokens={tokens} />
      </div>
    </div>
  );
}
